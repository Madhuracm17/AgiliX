import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Types } from 'mongoose';
import { GithubActivityService, MemberGithubActivity } from '../integrations/github/github-activity.service';
import type { CalendarLoad } from '../integrations/google-calendar/calendar-load';
import { GoogleCalendarService, MemberCalendar } from '../integrations/google-calendar/google-calendar.service';
import {
  DAY_MS,
  dayKey,
  forEachSlice,
  isLateNight,
  isWeekend,
  localParts,
  longestStreak,
  round1,
  teamTimeZone,
} from './team-time';

/** Windows the insights support (days back from now). */
export const INSIGHT_WINDOWS = [7, 14, 30] as const;
export const DEFAULT_INSIGHT_DAYS = 14;

/** A task In Progress for longer than this is "ageing". */
const AGEING_DAYS = 3;

export type SourceStatus = 'ok' | 'not_linked' | 'not_configured' | 'error' | 'not_connected';

/** Everything measured about one team member. All numbers are calculated, not guessed. */
export interface MemberSignals {
  userId: string;
  name: string;
  role: string;
  githubUsername: string | null;
  /** From AgiliX time tracking, in the window. */
  work: {
    hoursTracked: number;
    lateNightHours: number;
    weekendHours: number;
    activeDays: number;
    longestDayHours: number;
    longestStreakDays: number;
  };
  /** From AgiliX tasks assigned to them (open work is "now", done work is in the window). */
  tasks: {
    open: number;
    inProgress: number;
    inReview: number;
    openStoryPoints: number;
    ageingInProgress: number;
    doneInWindow: number;
    donePointsInWindow: number;
  };
  /** From the GitHub MCP server; null when GitHub is not available or the person is not linked. */
  github: Omit<MemberGithubActivity, 'userId' | 'name' | 'role' | 'githubUsername' | 'linked'> | null;
  /** From Google Calendar (meeting times only); null when the person has not connected it. */
  calendar: CalendarLoad | null;
}

export interface TeamContext {
  project: { id: string; name: string; methodology: string; wipLimit: number; githubRepo: string | null };
  windowDays: number;
  since: string;
  until: string;
  timezone: string;
  sources: { agilix: 'ok'; github: SourceStatus; calendar: SourceStatus };
  members: MemberSignals[];
  /** Team-wide GitHub figures for the window, when GitHub is available. */
  githubTeam: {
    commits: number;
    prsOpened: number;
    prsMerged: number;
    openPrs: number;
    stalePrs: number;
    reviews: number;
    dailyCommits: { date: string; commits: number }[];
  } | null;
  notes: string[];
}

interface TaskRecord {
  _id: unknown;
  assignee?: unknown;
  status?: string;
  storyPoints?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Builds the "context payload" for the AI insights: per-member signals from
 * AgiliX (MongoDB), GitHub (through the GitHub MCP server) and Google Calendar
 * (meeting times only, for people who connected their calendar).
 */
@Injectable()
export class TeamContextService {
  private readonly logger = new Logger('TeamContext');

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly github: GithubActivityService,
    private readonly calendar: GoogleCalendarService,
  ) {}

  async build(projectId: string, daysParam?: number | string): Promise<TeamContext> {
    if (!isValidObjectId(projectId)) throw new BadRequestException('Invalid project id');
    const asked = Number(daysParam);
    const days = (INSIGHT_WINDOWS as readonly number[]).includes(asked) ? asked : DEFAULT_INSIGHT_DAYS;

    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('name owner members methodology wipLimit githubRepo')
      .lean()
      .exec()) as {
      _id: unknown;
      name?: string;
      owner?: unknown;
      members?: unknown[];
      methodology?: string;
      wipLimit?: number;
      githubRepo?: string;
    } | null;
    if (!project) throw new NotFoundException('Project not found');

    const timezone = teamTimeZone();
    const now = Date.now();
    const since = now - days * DAY_MS;
    const projectMatch = { $in: [new Types.ObjectId(projectId), projectId] } as never;

    const team = await this.loadTeam(project.owner, project.members ?? []);
    const [tasks, entries, githubResult, calendarResult] = await Promise.all([
      this.connection
        .model('Task')
        .find({ project: projectMatch })
        .select('assignee status storyPoints startedAt completedAt')
        .lean()
        .exec() as Promise<TaskRecord[]>,
      this.connection
        .model('TimeEntry')
        .find({ project: projectMatch, endTime: { $ne: null }, startTime: { $gte: new Date(since) } })
        .select('user startTime endTime')
        .lean()
        .exec() as Promise<Array<{ user?: unknown; startTime?: Date; endTime?: Date }>>,
      this.loadGithub(projectId, project.githubRepo, days),
      this.loadCalendars(team.map((p) => p.id), since, now),
    ]);

    const githubByUser = new Map(
      (githubResult.report?.members ?? []).map((m) => [m.userId, m] as const),
    );

    const members: MemberSignals[] = team.map((person) => {
      // ---- Time tracking ----
      const hoursByDay = new Map<string, number>();
      let lateMs = 0;
      let weekendMs = 0;
      for (const entry of entries) {
        if (String(entry.user) !== person.id || !entry.startTime || !entry.endTime) continue;
        forEachSlice(new Date(entry.startTime).getTime(), new Date(entry.endTime).getTime(), (at, ms) => {
          const { hour, weekday } = localParts(at, timezone);
          const key = dayKey(at, timezone);
          hoursByDay.set(key, (hoursByDay.get(key) ?? 0) + ms / 3_600_000);
          if (isLateNight(hour)) lateMs += ms;
          if (isWeekend(weekday)) weekendMs += ms;
        });
      }
      const dailyHours = [...hoursByDay.values()];
      const totalHours = dailyHours.reduce((sum, h) => sum + h, 0);

      // ---- Tasks ----
      const mine = tasks.filter((t) => t.assignee && String(t.assignee) === person.id);
      const open = mine.filter((t) => t.status !== 'done');
      const inProgress = mine.filter((t) => t.status === 'in_progress');
      const doneInWindow = mine.filter(
        (t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= since,
      );

      // ---- GitHub ----
      const gh = githubByUser.get(person.id);
      const github =
        gh && gh.linked
          ? {
              commits: gh.commits,
              lateNightCommits: gh.lateNightCommits,
              weekendCommits: gh.weekendCommits,
              lastCommitAt: gh.lastCommitAt,
              commitDays: gh.commitDays,
              prsOpened: gh.prsOpened,
              prsMerged: gh.prsMerged,
              openPrs: gh.openPrs,
              stalePrs: gh.stalePrs,
              reviewsGiven: gh.reviewsGiven,
            }
          : null;

      // Days with tracked time OR commits both count as working days for the streak.
      const workedDays = new Set(hoursByDay.keys());
      for (const day of gh?.commitDays ?? []) workedDays.add(day);
      // ...and so do days with meetings.
      const cal = calendarResult.byUser.get(person.id);
      for (const day of cal?.meetingDays ?? []) workedDays.add(day);

      return {
        userId: person.id,
        name: person.name,
        role: person.role,
        githubUsername: person.githubUsername || null,
        work: {
          hoursTracked: round1(totalHours),
          lateNightHours: round1(lateMs / 3_600_000),
          weekendHours: round1(weekendMs / 3_600_000),
          activeDays: hoursByDay.size,
          longestDayHours: round1(dailyHours.length ? Math.max(...dailyHours) : 0),
          longestStreakDays: longestStreak(workedDays),
        },
        tasks: {
          open: open.length,
          inProgress: inProgress.length,
          inReview: mine.filter((t) => t.status === 'review').length,
          openStoryPoints: open.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
          ageingInProgress: inProgress.filter(
            (t) => t.startedAt && now - new Date(t.startedAt).getTime() > AGEING_DAYS * DAY_MS,
          ).length,
          doneInWindow: doneInWindow.length,
          donePointsInWindow: doneInWindow.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
        },
        github,
        calendar: cal?.load ?? null,
      };
    });

    const notes: string[] = [];
    if (githubResult.status === 'not_linked') notes.push('The project has no linked GitHub repository, so GitHub activity is not included.');
    if (githubResult.status === 'not_configured') notes.push('GitHub is not connected on the server (GITHUB_MCP_TOKEN), so GitHub activity is not included.');
    if (githubResult.status === 'error') notes.push('GitHub could not be reached just now, so GitHub activity is not included.');
    const unlinked = members.filter((m) => !m.githubUsername).map((m) => m.name);
    if (githubResult.status === 'ok' && unlinked.length) {
      notes.push(`No GitHub username for: ${unlinked.join(', ')}.`);
    }
    if (calendarResult.status === 'not_configured') {
      notes.push('Google Calendar is not set up on the server (GOOGLE_CLIENT_ID), so meeting load is not included.');
    } else {
      const noCalendar = members.filter((m) => !m.calendar).map((m) => m.name);
      if (noCalendar.length === members.length && members.length) {
        notes.push('Nobody on the team has connected Google Calendar yet, so meeting load is not included.');
      } else if (noCalendar.length) {
        notes.push(`No Google Calendar connected for: ${noCalendar.join(', ')}.`);
      }
    }

    const report = githubResult.report;
    return {
      project: {
        id: String(project._id),
        name: project.name ?? '',
        methodology: project.methodology ?? 'scrum',
        wipLimit: project.wipLimit ?? 0,
        githubRepo: project.githubRepo || null,
      },
      windowDays: days,
      since: new Date(since).toISOString(),
      until: new Date(now).toISOString(),
      timezone,
      sources: { agilix: 'ok', github: githubResult.status, calendar: calendarResult.status },
      members,
      githubTeam: report
        ? { ...report.totals, dailyCommits: report.dailyCommits }
        : null,
      notes,
    };
  }

  /** GitHub activity, or a status saying why it is missing. Never fails the whole insight. */
  private async loadGithub(projectId: string, repo: string | undefined, days: number) {
    if (!repo?.trim()) return { status: 'not_linked' as SourceStatus, report: null };
    if (!process.env.GITHUB_MCP_TOKEN?.trim()) {
      return { status: 'not_configured' as SourceStatus, report: null };
    }
    try {
      const report = await this.github.getActivity(projectId, days);
      return { status: 'ok' as SourceStatus, report };
    } catch (error) {
      this.logger.warn(`GitHub activity unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'error' as SourceStatus, report: null };
    }
  }

  /** Each member's meeting load from Google Calendar. Never fails the whole insight. */
  private async loadCalendars(userIds: string[], since: number, now: number) {
    const byUser = new Map<string, MemberCalendar>();
    if (!this.calendar.isConfigured()) return { status: 'not_configured' as SourceStatus, byUser };
    const results = await Promise.all(
      userIds.map(async (id) => [id, await this.calendar.memberCalendar(id, since, now)] as const),
    );
    for (const [id, cal] of results) byUser.set(id, cal);
    const statuses = results.map(([, cal]) => cal.status);
    const status: SourceStatus = statuses.includes('ok')
      ? 'ok'
      : statuses.includes('error')
        ? 'error'
        : 'not_connected';
    return { status, byUser };
  }

  /** Owner + members, without admins (they do not do project work). */
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
