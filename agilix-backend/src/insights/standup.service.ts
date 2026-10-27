import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Types } from 'mongoose';
import { LlmService, LlmValidationError } from '../ai/llm.service';
import { GithubActivityService } from '../integrations/github/github-activity.service';
import { DAY_MS, dayKey, localParts, teamTimeZone } from './team-time';

/** What the AI was given about one person (also returned, so the UI can show the evidence). */
export interface StandupFacts {
  userId: string;
  name: string;
  role: string;
  moved: { title: string; to: string; at: string }[];
  finished: string[];
  inProgress: { title: string; days: number | null }[];
  inReview: string[];
  nextUp: string[];
  sentBack: { title: string; note: string }[];
  commits: { message: string; at: string }[];
}

export interface MemberStandup {
  userId: string;
  name: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  facts: StandupFacts;
}

export interface StandupReport {
  project: { id: string; name: string };
  /** Activity counted from this moment (start of the previous working day, team time). */
  since: string;
  sinceLabel: string;
  generatedAt: string;
  github: 'ok' | 'not_linked' | 'not_configured' | 'error';
  headline: string;
  members: MemberStandup[];
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const AGEING_DAYS = 3;
const CACHE_MS = 10 * 60_000;

const SYSTEM_PROMPT = `You write the DAILY STANDUP for a software team, from activity recorded in their project tool (AgiliX) and their GitHub repository.

For each member write the three classic standup answers:
- "yesterday": what they got done or worked on since the last standup — tasks finished or moved, and what their commits did (summarise commit messages into plain work items; do not list commit hashes). 0 to 4 short items.
- "today": what they will most likely work on today — their tasks in progress first, then work waiting for them (sent back from review), then the next To-do tasks. 1 to 3 short items.
- "blockers": real risks only — a task sent back from review, work stuck in progress for several days, waiting on review. 0 to 3 short items. Use an empty list when nothing is blocking.

Rules:
- Use ONLY the facts given. Do not invent tasks, people or progress. If someone has no recorded activity, say "No updates recorded" as the single "yesterday" item.
- Write each item as a short phrase in plain English (max ~15 words), using task titles where helpful.
- Do not mention working hours or judge anyone's effort.
- "headline": one or two sentences for the whole team: what moved forward and the most important blocker.

Respond with a single JSON object and nothing else, no markdown:
{ "headline": "...", "members": [ { "userId": "<exactly as given>", "yesterday": ["..."], "today": ["..."], "blockers": ["..."] } ] }
Include every member exactly once, using the userId values exactly as given.`;

/**
 * AI daily standup: per member, what changed since the previous working day
 * (task moves from AgiliX, commit messages from the GitHub MCP server), what is
 * next and what is blocking. The facts are collected in code; the LLM writes
 * them up as a standup and the answer is validated.
 */
@Injectable()
export class StandupService {
  private readonly logger = new Logger('Standup');
  private readonly cache = new Map<string, { at: number; report: StandupReport }>();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly github: GithubActivityService,
    private readonly llm: LlmService,
  ) {}

  async summarize(projectId: string, refresh = false): Promise<StandupReport> {
    if (!isValidObjectId(projectId)) throw new BadRequestException('Invalid project id');
    const cached = this.cache.get(projectId);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;

    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('name owner members githubRepo')
      .lean()
      .exec()) as { _id: unknown; name?: string; owner?: unknown; members?: unknown[]; githubRepo?: string } | null;
    if (!project) throw new NotFoundException('Project not found');

    const timezone = teamTimeZone();
    const now = Date.now();
    const { since, label } = previousWorkingDayStart(now, timezone);

    const team = await this.loadTeam(project.owner, project.members ?? []);
    const projectMatch = { $in: [new Types.ObjectId(projectId), projectId] } as never;
    const tasks = (await this.connection
      .model('Task')
      .find({ project: projectMatch })
      .select('title status priority assignee startedAt completedAt statusHistory reviewNote')
      .lean()
      .exec()) as Array<{
      title?: string;
      status?: string;
      priority?: string;
      assignee?: unknown;
      startedAt?: Date | null;
      completedAt?: Date | null;
      statusHistory?: { status: string; at: Date }[];
      reviewNote?: { text?: string; byName?: string } | null;
    }>;

    // ---- GitHub commit messages since the last standup ----
    let githubStatus: StandupReport['github'] = 'not_linked';
    let commits: { login: string | null; message: string; at: string }[] = [];
    if (project.githubRepo?.trim()) {
      if (!process.env.GITHUB_MCP_TOKEN?.trim()) {
        githubStatus = 'not_configured';
      } else {
        try {
          commits = await this.github.getRecentCommits(project.githubRepo.trim(), new Date(since));
          githubStatus = 'ok';
        } catch (error) {
          githubStatus = 'error';
          this.logger.warn(`GitHub commits unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const facts: StandupFacts[] = team.map((person) => {
      const mine = tasks.filter((t) => t.assignee && String(t.assignee) === person.id);
      const moved = mine.flatMap((t) =>
        (t.statusHistory ?? [])
          .filter((h) => h.at && +new Date(h.at) >= since)
          .map((h) => ({ title: t.title ?? '', to: STATUS_LABEL[h.status] ?? h.status, at: new Date(h.at).toISOString() })),
      );
      const login = person.githubUsername.toLowerCase();
      return {
        userId: person.id,
        name: person.name,
        role: person.role,
        moved,
        finished: mine
          .filter((t) => t.status === 'done' && t.completedAt && +new Date(t.completedAt) >= since)
          .map((t) => t.title ?? ''),
        inProgress: mine
          .filter((t) => t.status === 'in_progress')
          .map((t) => ({
            title: t.title ?? '',
            days: t.startedAt ? Math.floor((now - +new Date(t.startedAt)) / DAY_MS) : null,
          })),
        inReview: mine.filter((t) => t.status === 'review').map((t) => t.title ?? ''),
        nextUp: mine
          .filter((t) => t.status === 'todo')
          .sort((a, b) => (PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1))
          .slice(0, 3)
          .map((t) => t.title ?? ''),
        sentBack: mine
          .filter((t) => t.reviewNote && t.status !== 'done')
          .map((t) => ({ title: t.title ?? '', note: (t.reviewNote?.text ?? '').slice(0, 200) })),
        commits: login
          ? commits
              .filter((c) => c.login?.toLowerCase() === login)
              .slice(0, 10)
              .map((c) => ({ message: c.message, at: c.at }))
          : [],
      };
    });

    const base = {
      project: { id: String(project._id), name: project.name ?? '' },
      since: new Date(since).toISOString(),
      sinceLabel: label,
      generatedAt: new Date().toISOString(),
      github: githubStatus,
    };
    if (facts.length === 0) {
      return { ...base, headline: 'This project has no team members yet.', members: [] };
    }

    const ids = facts.map((f) => f.userId);
    const answer = await this.llm.completeJson({
      task: 'standup',
      system: SYSTEM_PROMPT,
      user: buildPrompt(project.name ?? '', label, githubStatus, facts),
      validate: (value) => validateAnswer(value, ids),
      temperature: 0.3,
      maxTokens: 1500,
    });

    const byId = new Map(facts.map((f) => [f.userId, f] as const));
    const report: StandupReport = {
      ...base,
      headline: answer.headline,
      members: answer.members.map((m) => {
        const f = byId.get(m.userId) as StandupFacts;
        return { ...m, name: f.name, facts: f };
      }),
    };
    this.cache.set(projectId, { at: Date.now(), report });
    return report;
  }

  private async loadTeam(owner: unknown, members: unknown[]) {
    const ids = [...new Set([owner, ...members].filter((v) => v != null).map(String))].filter((id) =>
      isValidObjectId(id),
    );
    const users = (await this.connection
      .model('User')
      .find({ _id: { $in: ids } })
      .select('name role githubUsername')
      .lean()
      .exec()) as Array<{ _id: unknown; name?: string; role?: string; githubUsername?: string }>;
    return users
      .filter((u) => u.role !== 'admin')
      .map((u) => ({
        id: String(u._id),
        name: u.name ?? '',
        role: u.role ?? 'developer',
        githubUsername: (u.githubUsername ?? '').trim(),
      }));
  }
}

/**
 * Start (00:00 team time) of the previous working day: yesterday, or Friday
 * when today is Saturday, Sunday or Monday.
 */
export function previousWorkingDayStart(now: number, timeZone: string): { since: number; label: string } {
  const back = { Mon: 3, Sun: 2, Sat: 1 }[localParts(now, timeZone).weekday] ?? 1;
  const target = dayKey(now - back * DAY_MS, timeZone); // YYYY-MM-DD in team time
  // Find the UTC moment of 00:00 team time on that date (the zone's offset, read at noon UTC).
  const noonUtc = Date.parse(`${target}T12:00:00Z`);
  const { hour } = localParts(noonUtc, timeZone);
  const minutes = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, minute: '2-digit' }).format(new Date(noonUtc)),
  );
  const offsetMinutes = (hour - 12) * 60 + minutes;
  const since = Date.parse(`${target}T00:00:00Z`) - offsetMinutes * 60_000;
  const label = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'short' }).format(
    new Date(noonUtc),
  );
  return { since, label };
}

function buildPrompt(projectName: string, label: string, github: string, facts: StandupFacts[]): string {
  const lines = [
    `Project: ${projectName}`,
    `Activity since: ${label} (start of the previous working day)`,
    `GitHub commits: ${github === 'ok' ? 'available' : `not available (${github.replace('_', ' ')})`}`,
    '',
    'Members:',
  ];
  for (const f of facts) {
    lines.push(
      '',
      `userId: ${f.userId}`,
      `name: ${f.name} (${f.role})`,
      `- Tasks moved: ${f.moved.length ? f.moved.map((m) => `"${m.title}" → ${m.to}`).join('; ') : 'none'}`,
      `- Finished: ${f.finished.length ? f.finished.map((t) => `"${t}"`).join('; ') : 'none'}`,
      `- In progress now: ${
        f.inProgress.length
          ? f.inProgress.map((t) => `"${t.title}"${t.days !== null ? ` (${t.days} days${t.days > AGEING_DAYS ? ', stuck' : ''})` : ''}`).join('; ')
          : 'none'
      }`,
      `- Waiting in review: ${f.inReview.length ? f.inReview.map((t) => `"${t}"`).join('; ') : 'none'}`,
      `- Sent back from review: ${f.sentBack.length ? f.sentBack.map((s) => `"${s.title}"${s.note ? ` (note: ${s.note})` : ''}`).join('; ') : 'none'}`,
      `- Next To-do: ${f.nextUp.length ? f.nextUp.map((t) => `"${t}"`).join('; ') : 'none'}`,
      `- Commits: ${github !== 'ok' ? 'unknown' : f.commits.length ? f.commits.map((c) => `"${c.message}"`).join('; ') : 'none'}`,
    );
  }
  return lines.join('\n');
}

function validateAnswer(
  value: unknown,
  ids: string[],
): { headline: string; members: Array<Pick<MemberStandup, 'userId' | 'yesterday' | 'today' | 'blockers'>> } {
  if (!value || typeof value !== 'object') throw new LlmValidationError('answer is not an object');
  const v = value as Record<string, unknown>;
  const headline = typeof v.headline === 'string' ? v.headline.trim().slice(0, 500) : '';
  if (!headline) throw new LlmValidationError('headline is missing');
  if (!Array.isArray(v.members)) throw new LlmValidationError('members is not an array');

  const list = (x: unknown, max: number) =>
    Array.isArray(x)
      ? x.filter((i): i is string => typeof i === 'string' && !!i.trim()).map((i) => i.trim().slice(0, 200)).slice(0, max)
      : [];

  const seen = new Set<string>();
  const members = v.members.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new LlmValidationError('member entry is not an object');
    const m = raw as Record<string, unknown>;
    const userId = String(m.userId ?? '').trim();
    if (!ids.includes(userId)) throw new LlmValidationError('unknown userId in answer');
    if (seen.has(userId)) throw new LlmValidationError('duplicate userId in answer');
    seen.add(userId);
    const yesterday = list(m.yesterday, 4);
    const today = list(m.today, 3);
    return {
      userId,
      yesterday: yesterday.length ? yesterday : ['No updates recorded'],
      today: today.length ? today : ['Pick up the next task'],
      blockers: list(m.blockers, 3),
    };
  });
  if (seen.size !== ids.length) throw new LlmValidationError('not every member was included');
  return { headline, members };
}
