import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId } from 'mongoose';
import { GithubMcpClient } from './github-mcp.client';

/** Windows the activity report supports (days back from now). */
export const GITHUB_ACTIVITY_WINDOWS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

/** Commits at or after 22:00 or before 06:00 (team time) count as late-night. */
const LATE_START_HOUR = 22;
const LATE_END_HOUR = 6;
/** An open pull request older than this is "stale" (waiting too long). */
const STALE_PR_DAYS = 3;
/** Limits that keep one report to a handful of GitHub calls. */
const MAX_COMMIT_PAGES = 5;
const MAX_PRS_FOR_REVIEWS = 20;
const CACHE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export interface MemberGithubActivity {
  userId: string;
  name: string;
  role: string;
  githubUsername: string | null;
  /** false = no GitHub username set, so nothing can be counted for them. */
  linked: boolean;
  commits: number;
  lateNightCommits: number;
  weekendCommits: number;
  lastCommitAt: string | null;
  prsOpened: number;
  prsMerged: number;
  openPrs: number;
  stalePrs: number;
  reviewsGiven: number;
}

export interface GithubActivityReport {
  source: 'github-mcp';
  project: { id: string; name: string };
  repo: string;
  days: number;
  since: string;
  timezone: string;
  generatedAt: string;
  totals: {
    commits: number;
    prsOpened: number;
    prsMerged: number;
    openPrs: number;
    stalePrs: number;
    reviews: number;
  };
  /** Commits per day (team time zone), oldest first, one entry per day in the window. */
  dailyCommits: { date: string; commits: number }[];
  members: MemberGithubActivity[];
  /** People who committed to the repo but are not linked to anyone on the team. */
  unlinkedContributors: { login: string; commits: number }[];
  notes: string[];
}

/* Loose shapes of what GitHub's MCP tools return (both snake_case and camelCase are accepted). */
type Person = { login?: string } | string | null | undefined;
interface RawCommit {
  sha?: string;
  author?: Person;
  commit?: { author?: { name?: string; date?: string }; committer?: { date?: string } };
}
interface RawPull {
  number?: number;
  state?: string;
  draft?: boolean;
  user?: Person;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  merged_at?: string | null;
  mergedAt?: string | null;
}
interface RawReview {
  user?: Person;
  state?: string;
  submitted_at?: string;
  submittedAt?: string;
}

/**
 * GitHub activity per team member for a project's linked repository, read
 * through the GitHub MCP server. This is the GitHub part of the "context
 * payload" that sprint health and burnout risk are built from.
 */
@Injectable()
export class GithubActivityService {
  private readonly cache = new Map<string, { at: number; report: GithubActivityReport }>();

  constructor(
    private readonly github: GithubMcpClient,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async getActivity(projectId: string, daysParam?: number | string): Promise<GithubActivityReport> {
    if (!isValidObjectId(projectId)) throw new BadRequestException('Invalid project id');
    const asked = Number(daysParam);
    const days = (GITHUB_ACTIVITY_WINDOWS as readonly number[]).includes(asked) ? asked : DEFAULT_DAYS;

    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('name owner members githubRepo')
      .lean()
      .exec()) as { _id: unknown; name?: string; owner?: unknown; members?: unknown[]; githubRepo?: string } | null;
    if (!project) throw new NotFoundException('Project not found');

    const repo = (project.githubRepo ?? '').trim();
    if (!repo) {
      throw new BadRequestException(
        'This project is not linked to a GitHub repository yet. A manager can add it under "Edit project".',
      );
    }

    // The team is read first (one quick query) so that linking a GitHub username
    // shows up straight away instead of after the cache expires.
    const team = await this.loadTeam(project.owner, project.members ?? []);
    const cacheKey = [projectId, days, repo, ...team.map((p) => `${p.id}=${p.githubUsername}`)].join('|');
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.report;

    const [owner, name] = repo.split('/');
    const timezone = process.env.TEAM_TIMEZONE?.trim() || 'Asia/Kolkata';
    const now = Date.now();
    const since = new Date(now - days * DAY_MS);

    const [commits, pulls] = await Promise.all([
      this.fetchCommits(owner, name, since),
      this.fetchPulls(owner, name, since),
    ]);
    const reviews = await this.fetchReviews(owner, name, pulls);

    // ---- Per-member counters, keyed by lower-case GitHub login ----
    const byLogin = new Map<string, MemberGithubActivity>();
    const members: MemberGithubActivity[] = team.map((person) => {
      const entry: MemberGithubActivity = {
        userId: person.id,
        name: person.name,
        role: person.role,
        githubUsername: person.githubUsername || null,
        linked: !!person.githubUsername,
        commits: 0,
        lateNightCommits: 0,
        weekendCommits: 0,
        lastCommitAt: null,
        prsOpened: 0,
        prsMerged: 0,
        openPrs: 0,
        stalePrs: 0,
        reviewsGiven: 0,
      };
      if (person.githubUsername) byLogin.set(person.githubUsername.toLowerCase(), entry);
      return entry;
    });

    const unlinked = new Map<string, number>();
    const daily = new Map<string, number>();
    // One entry per calendar day from the day the window starts up to today.
    for (let i = days; i >= 0; i -= 1) daily.set(dayKey(now - i * DAY_MS, timezone), 0);

    for (const commit of commits) {
      const at = commit.commit?.author?.date ?? commit.commit?.committer?.date;
      if (!at) continue;
      const time = Date.parse(at);
      const key = dayKey(time, timezone);
      if (daily.has(key)) daily.set(key, (daily.get(key) ?? 0) + 1);

      const login = loginOf(commit.author);
      const member = login ? byLogin.get(login.toLowerCase()) : undefined;
      if (!member) {
        const label = login ?? commit.commit?.author?.name ?? 'unknown';
        unlinked.set(label, (unlinked.get(label) ?? 0) + 1);
        continue;
      }
      member.commits += 1;
      const { hour, weekday } = localParts(time, timezone);
      if (hour >= LATE_START_HOUR || hour < LATE_END_HOUR) member.lateNightCommits += 1;
      if (weekday === 'Sat' || weekday === 'Sun') member.weekendCommits += 1;
      if (!member.lastCommitAt || time > Date.parse(member.lastCommitAt)) {
        member.lastCommitAt = new Date(time).toISOString();
      }
    }

    let prsOpened = 0;
    let prsMerged = 0;
    let openPrs = 0;
    let stalePrs = 0;
    for (const pull of pulls) {
      const created = Date.parse(pull.created_at ?? pull.createdAt ?? '');
      const mergedAt = pull.merged_at ?? pull.mergedAt ?? null;
      const isOpen = pull.state === 'open';
      const isStale = isOpen && !pull.draft && now - created > STALE_PR_DAYS * DAY_MS;
      const openedInWindow = created >= since.getTime();
      const mergedInWindow = !!mergedAt && Date.parse(mergedAt) >= since.getTime();

      if (openedInWindow) prsOpened += 1;
      if (mergedInWindow) prsMerged += 1;
      if (isOpen) openPrs += 1;
      if (isStale) stalePrs += 1;

      const login = loginOf(pull.user);
      const member = login ? byLogin.get(login.toLowerCase()) : undefined;
      if (!member) continue;
      if (openedInWindow) member.prsOpened += 1;
      if (mergedInWindow) member.prsMerged += 1;
      if (isOpen) member.openPrs += 1;
      if (isStale) member.stalePrs += 1;
    }

    let reviewCount = 0;
    for (const review of reviews) {
      const at = Date.parse(review.submitted_at ?? review.submittedAt ?? '');
      if (!(at >= since.getTime()) || review.state === 'PENDING') continue;
      reviewCount += 1;
      const login = loginOf(review.user);
      const member = login ? byLogin.get(login.toLowerCase()) : undefined;
      if (member) member.reviewsGiven += 1;
    }

    const notLinked = members.filter((m) => !m.linked).map((m) => m.name);
    const notes: string[] = [];
    if (notLinked.length) {
      notes.push(
        `${notLinked.join(', ')} ${notLinked.length === 1 ? 'has' : 'have'} no GitHub username in AgiliX, ` +
          'so their GitHub activity cannot be counted.',
      );
    }
    if (commits.length >= MAX_COMMIT_PAGES * 100) {
      notes.push(`Only the latest ${commits.length} commits were read.`);
    }
    if (unlinked.size) {
      notes.push('Some commits are from GitHub accounts not linked to anyone on this team (see unlinkedContributors).');
    }

    const report: GithubActivityReport = {
      source: 'github-mcp',
      project: { id: String(project._id), name: project.name ?? '' },
      repo,
      days,
      since: since.toISOString(),
      timezone,
      generatedAt: new Date(now).toISOString(),
      totals: { commits: commits.length, prsOpened, prsMerged, openPrs, stalePrs, reviews: reviewCount },
      dailyCommits: [...daily.entries()].map(([date, count]) => ({ date, commits: count })),
      members,
      unlinkedContributors: [...unlinked.entries()]
        .map(([login, count]) => ({ login, commits: count }))
        .sort((a, b) => b.commits - a.commits),
      notes,
    };
    this.cache.set(cacheKey, { at: now, report });
    return report;
  }

  /** Owner + members with the fields needed to match GitHub logins. */
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

  private async fetchCommits(owner: string, repo: string, since: Date): Promise<RawCommit[]> {
    const all: RawCommit[] = [];
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
      const batch = asArray<RawCommit>(
        await this.github.callJson('list_commits', {
          owner,
          repo,
          since: since.toISOString().slice(0, 19) + 'Z',
          perPage: 100,
          page,
        }),
      );
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  /** PRs updated in the window, plus every PR that is still open. */
  private async fetchPulls(owner: string, repo: string, since: Date): Promise<RawPull[]> {
    const batch = asArray<RawPull>(
      await this.github.callJson('list_pull_requests', {
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        perPage: 100,
      }),
    );
    return batch.filter((pull) => {
      const updated = Date.parse(pull.updated_at ?? pull.updatedAt ?? '');
      return pull.state === 'open' || updated >= since.getTime();
    });
  }

  private async fetchReviews(owner: string, repo: string, pulls: RawPull[]): Promise<RawReview[]> {
    const numbers = pulls
      .map((pull) => pull.number)
      .filter((n): n is number => typeof n === 'number')
      .slice(0, MAX_PRS_FOR_REVIEWS);
    const reviews: RawReview[] = [];
    // A few at a time, to stay polite with GitHub's rate limits.
    for (let i = 0; i < numbers.length; i += 5) {
      const chunk = await Promise.all(
        numbers.slice(i, i + 5).map((pullNumber) =>
          this.github
            .callJson('pull_request_read', { method: 'get_reviews', owner, repo, pullNumber })
            .then((data) => asArray<RawReview>(data))
            .catch(() => [] as RawReview[]),
        ),
      );
      chunk.forEach((list) => reviews.push(...list));
    }
    return reviews;
  }
}

/** GitHub MCP tools return either a plain array or an object wrapping one. */
function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    for (const key of ['items', 'commits', 'pull_requests', 'pullRequests', 'reviews', 'data']) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function loginOf(person: Person): string | null {
  if (!person) return null;
  if (typeof person === 'string') return person;
  return person.login ?? null;
}

/** "YYYY-MM-DD" of a moment in the team's time zone. */
function dayKey(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(time),
  );
}

/** Hour (0–23) and short weekday ("Mon") of a moment in the team's time zone. */
function localParts(time: number, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(time));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { hour, weekday };
}
