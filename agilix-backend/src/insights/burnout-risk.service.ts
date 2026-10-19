import { Injectable } from '@nestjs/common';
import { LlmService, LlmValidationError } from '../ai/llm.service';
import {
  DEFAULT_INSIGHT_DAYS,
  INSIGHT_WINDOWS,
  MemberSignals,
  TeamContext,
  TeamContextService,
} from './team-context.service';

export type BurnoutLevel = 'low' | 'medium' | 'high';

export interface MemberBurnoutRisk {
  userId: string;
  name: string;
  risk: BurnoutLevel;
  /** 0 = no sign of strain, 100 = severe burnout risk. */
  score: number;
  reasons: string[];
  recommendations: string[];
  /** The measured numbers the AI was given for this person (shown as evidence). */
  signals: MemberSignals;
}

export interface BurnoutRiskReport {
  project: TeamContext['project'];
  windowDays: number;
  since: string;
  until: string;
  generatedAt: string;
  sources: TeamContext['sources'];
  teamSummary: string;
  members: MemberBurnoutRisk[];
  notes: string[];
}

const LEVELS: readonly BurnoutLevel[] = ['low', 'medium', 'high'];
const CACHE_MS = 10 * 60_000;

const SYSTEM_PROMPT = `You are an experienced engineering manager and Agile coach. You assess the BURNOUT RISK of each member of a software team from measured work signals, so the manager can act early and kindly.

Rules:
- Base every judgement ONLY on the data given. Do not invent facts, people, deadlines, health issues or personal circumstances. Never diagnose anyone; you assess work-pattern risk, not health.
- All numbers are already calculated. Use them as given; do not recalculate.
- A data source marked as unavailable, or a member with no data from it, means UNKNOWN, not zero effort and not safe. Say so when it matters.
- A member with little or no data should be "low" risk with a reason saying there is not enough data to judge.
- Burnout warning signs, roughly in order of weight:
  1. Sustained long hours: more than about 45 tracked hours per week, or single days above 10 hours.
  2. Working at unhealthy times: late-night hours or commits (22:00-06:00) and weekend work, especially when repeated.
  3. No recovery: long streaks of consecutive working days (7+ is a warning, 10+ is serious).
  4. Overload: many open tasks or story points at once, several tasks in progress in parallel, tasks stuck in progress (ageing).
  5. Spiky "crunch" patterns: many commits on one day after quiet days.
  6. Carrying review load or open pull requests for others on top of their own work.
- Being productive is NOT a burnout sign by itself; look for the pattern of strain.
- Levels: "low" = no meaningful warning signs; "medium" = some signs, worth watching or small adjustments; "high" = several strong signs together, act now.
- Score: integer 0-100 consistent with the level (low 0-34, medium 35-64, high 65-100).
- Reasons: 1 to 4 short sentences that quote the actual numbers (e.g. "6.5 of 31 tracked hours were after 10 pm").
- Recommendations: 1 to 3 short, concrete, kind actions for the MANAGER (rebalance tasks, protect evenings, pair on reviews...). Name other team members only if the data shows they have spare capacity.

Respond with a single JSON object and nothing else, no markdown:
{
  "teamSummary": "2 or 3 sentences about the team as a whole",
  "members": [
    { "userId": "<exactly as given>", "risk": "low|medium|high", "score": 0-100, "reasons": ["..."], "recommendations": ["..."] }
  ]
}
Include every member exactly once, using the userId values exactly as given.`;

/**
 * AI burnout risk per team member. The numbers come from TeamContextService
 * (AgiliX time tracking and tasks, GitHub through the GitHub MCP server); the
 * LLM interprets them and explains its verdict. The answer is validated before
 * it is returned, and the measured signals are returned with it as evidence.
 */
@Injectable()
export class BurnoutRiskService {
  private readonly cache = new Map<string, { at: number; report: BurnoutRiskReport }>();

  constructor(
    private readonly context: TeamContextService,
    private readonly llm: LlmService,
  ) {}

  async assess(projectId: string, days?: number | string, refresh = false): Promise<BurnoutRiskReport> {
    const asked = Number(days);
    const window = (INSIGHT_WINDOWS as readonly number[]).includes(asked) ? asked : DEFAULT_INSIGHT_DAYS;
    const key = `${projectId}:${window}`;
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;

    const ctx = await this.context.build(projectId, window);

    const base = {
      project: ctx.project,
      windowDays: ctx.windowDays,
      since: ctx.since,
      until: ctx.until,
      generatedAt: new Date().toISOString(),
      sources: ctx.sources,
      notes: ctx.notes,
    };

    if (ctx.members.length === 0) {
      return { ...base, teamSummary: 'This project has no team members yet.', members: [] };
    }

    const ids = ctx.members.map((m) => m.userId);
    const answer = await this.llm.completeJson({
      task: 'burnout-risk',
      system: SYSTEM_PROMPT,
      user: buildPrompt(ctx),
      validate: (value) => validateAnswer(value, ids),
      temperature: 0.2,
      maxTokens: 1800,
    });

    const byId = new Map(ctx.members.map((m) => [m.userId, m] as const));
    const report: BurnoutRiskReport = {
      ...base,
      teamSummary: answer.teamSummary,
      members: answer.members
        .map((m) => {
          const signals = byId.get(m.userId) as MemberSignals;
          return { ...m, name: signals.name, signals };
        })
        .sort((a, b) => b.score - a.score),
    };
    this.cache.set(key, { at: Date.now(), report });
    return report;
  }
}

/** The facts for the model, compact and labelled. */
function buildPrompt(ctx: TeamContext): string {
  const sourceLine = (label: string, status: string) =>
    `- ${label}: ${status === 'ok' ? 'available' : `NOT available (${status.replace('_', ' ')})`}`;

  const lines = [
    `Project: ${ctx.project.name} (${ctx.project.methodology})`,
    `Window: last ${ctx.windowDays} days, ${ctx.since.slice(0, 10)} to ${ctx.until.slice(0, 10)} (team time zone ${ctx.timezone})`,
    '',
    'Data sources:',
    sourceLine('AgiliX time tracking and tasks', 'ok'),
    sourceLine('GitHub activity', ctx.sources.github),
    sourceLine('Calendar meetings', ctx.sources.calendar),
    '',
  ];

  if (ctx.githubTeam) {
    lines.push(
      `Team GitHub totals: ${ctx.githubTeam.commits} commits, ${ctx.githubTeam.prsMerged} PRs merged, ` +
        `${ctx.githubTeam.reviews} reviews, ${ctx.githubTeam.openPrs} open PRs (${ctx.githubTeam.stalePrs} stale).`,
      '',
    );
  }

  lines.push('Members:');
  for (const m of ctx.members) {
    const w = m.work;
    const t = m.tasks;
    lines.push(
      '',
      `userId: ${m.userId}`,
      `name: ${m.name} (${m.role})`,
      `- Time tracked: ${w.hoursTracked} h over ${w.activeDays} active days; longest day ${w.longestDayHours} h; ` +
        `late-night ${w.lateNightHours} h; weekend ${w.weekendHours} h; longest streak of consecutive working days: ${w.longestStreakDays}`,
      `- Tasks now: ${t.open} open (${t.openStoryPoints} story points), ${t.inProgress} in progress ` +
        `(${t.ageingInProgress} in progress for over 3 days), ${t.inReview} in review`,
      `- Finished in the window: ${t.doneInWindow} tasks (${t.donePointsInWindow} story points)`,
    );
    if (m.github) {
      const g = m.github;
      lines.push(
        `- GitHub (@${m.githubUsername}): ${g.commits} commits (${g.lateNightCommits} late-night, ${g.weekendCommits} on weekends) ` +
          `on ${g.commitDays.length} days${g.commitDays.length ? ` [${g.commitDays.join(', ')}]` : ''}; ` +
          `PRs opened ${g.prsOpened}, merged ${g.prsMerged}, open ${g.openPrs} (${g.stalePrs} stale); reviews given ${g.reviewsGiven}`,
      );
    } else {
      lines.push(
        ctx.sources.github === 'ok'
          ? '- GitHub: unknown (no GitHub username linked for this person)'
          : '- GitHub: unknown (GitHub data not available)',
      );
    }
    lines.push('- Meetings: unknown (Calendar not connected)');
  }

  return lines.join('\n');
}

interface Answer {
  teamSummary: string;
  members: Array<Omit<MemberBurnoutRisk, 'name' | 'signals'>>;
}

/** Trusts nothing: shape, enums, ranges, lengths, and exactly one entry per member. */
function validateAnswer(value: unknown, ids: string[]): Answer {
  if (!value || typeof value !== 'object') throw new LlmValidationError('answer is not an object');
  const v = value as Record<string, unknown>;

  const teamSummary = cleanText(v.teamSummary, 600);
  if (!teamSummary) throw new LlmValidationError('teamSummary is missing');
  if (!Array.isArray(v.members)) throw new LlmValidationError('members is not an array');

  const seen = new Set<string>();
  const members = v.members.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new LlmValidationError('member entry is not an object');
    const m = raw as Record<string, unknown>;
    const userId = String(m.userId ?? '').trim();
    if (!ids.includes(userId)) throw new LlmValidationError('unknown userId in answer');
    if (seen.has(userId)) throw new LlmValidationError('duplicate userId in answer');
    seen.add(userId);

    const risk = String(m.risk ?? '').toLowerCase() as BurnoutLevel;
    if (!LEVELS.includes(risk)) throw new LlmValidationError('risk is not low, medium or high');

    const score = Number(m.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new LlmValidationError('score out of range');

    const reasons = cleanList(m.reasons, 4);
    const recommendations = cleanList(m.recommendations, 3);
    if (!reasons.length) throw new LlmValidationError('reasons missing');
    if (!recommendations.length) throw new LlmValidationError('recommendations missing');

    return { userId, risk, score: Math.round(score), reasons, recommendations };
  });

  if (seen.size !== ids.length) throw new LlmValidationError('not every member was assessed');
  return { teamSummary, members };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, 300))
    .filter(Boolean)
    .slice(0, max);
}
