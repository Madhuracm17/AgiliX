import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { computeSprintTiming, summarizeVelocity } from '../ai/ai.service';
import { LlmService, LlmValidationError } from '../ai/llm.service';
import { SprintsService } from '../sprints/sprints.service';
import { TasksService } from '../tasks/tasks.service';
import { TeamContext, TeamContextService } from './team-context.service';
import { DAY_MS, round1 } from './team-time';

export type HealthStatus = 'healthy' | 'at_risk' | 'critical';

/** Numbers measured from AgiliX (and GitHub) that the AI judged; returned as evidence. */
export interface HealthFacts {
  mode: 'sprint' | 'flow';
  sprint?: {
    id: string;
    name: string;
    goal: string;
    phase: string;
    elapsedPercent: number;
    elapsedDays: number;
    remainingDays: number;
    tasks: { total: number; todo: number; inProgress: number; review: number; done: number };
    storyPoints: { total: number; done: number };
    addedAfterStart: number;
    unassigned: number;
    velocityPerSprint: number | null;
  };
  flow?: {
    wip: number;
    wipLimit: number;
    todo: number;
    inReview: number;
    unassignedOpen: number;
    throughputThisPeriod: number;
    throughputPreviousPeriod: number;
    medianCycleDays: number | null;
  };
  ageingInProgress: number;
  doneLast3Days: number;
  github: TeamContext['githubTeam'];
  team: Array<{
    name: string;
    openTasks: number;
    inProgress: number;
    hoursTracked: number;
    lateNightHours: number;
    /** From Google Calendar; null when the person has not connected it. */
    meetings: { hours: number; next7DaysHours: number; outOfOfficeDaysNext7: number } | null;
  }>;
}

export interface SprintHealthReport {
  project: TeamContext['project'];
  generatedAt: string;
  windowDays: number;
  sources: TeamContext['sources'];
  status: HealthStatus;
  /** 0 = in serious trouble, 100 = very healthy. */
  score: number;
  /** Sprint mode only: share of the sprint's planned work expected to be done by the end date. */
  completionForecastPercent: number | null;
  summary: string;
  risks: string[];
  recommendations: string[];
  facts: HealthFacts;
  notes: string[];
}

const STATUSES: readonly HealthStatus[] = ['healthy', 'at_risk', 'critical'];
const AGEING_DAYS = 3;
const CACHE_MS = 10 * 60_000;

const SYSTEM_PROMPT = `You are an experienced Agile coach assessing the HEALTH of a software team's current delivery, for the team's manager.

There are two modes:
- "sprint": a Scrum sprint is active. Judge whether it will deliver its planned work by the end date, and how healthy the way of working is.
- "flow": no sprint (Kanban, or no active sprint). Judge the health of the flow of work: work in progress vs the WIP limit, throughput trend, items stuck in progress, review queue.

Rules:
- Base every judgement ONLY on the data given. Do not invent facts, people or blockers. All numbers are already calculated; use them as given.
- A data source marked as not available means UNKNOWN, not zero.
- Signals of poor health: progress behind time elapsed; scope added after the sprint started; many tasks still To do late in the sprint; items stuck In Progress (ageing); work piling up in Review; WIP above the limit; falling throughput; unassigned work; pull requests merged with no reviews; stale open pull requests; commits concentrated on a few days (crunch) or long quiet gaps; one person carrying most of the load or working late nights.
- Capacity: meeting hours and out-of-office days (from Google Calendar) reduce the time left for sprint work; heavy upcoming meetings or absences near the end of a sprint lower the forecast. People without calendar data have UNKNOWN meeting load.
- Signals of good health: steady daily progress, work finishing regularly, reviews happening, balanced load.
- Status: "healthy" = on track with no serious issues; "at_risk" = recoverable problems that need attention now; "critical" = unlikely to deliver, or serious process problems.
- Score: integer 0-100 where 100 is very healthy, consistent with the status (critical 0-39, at_risk 40-69, healthy 70-100).
- completionForecastPercent: in "sprint" mode an integer 0-100, the share of the sprint's planned work you expect to be Done by the end date; in "flow" mode it must be null.
- summary: 2 or 3 sentences quoting the key numbers.
- risks: 0 to 5 short sentences, the most important first, each quoting numbers.
- recommendations: 1 to 4 short, concrete actions for the manager.

Respond with a single JSON object and nothing else, no markdown:
{ "status": "healthy|at_risk|critical", "score": 0-100, "completionForecastPercent": <integer or null>, "summary": "...", "risks": ["..."], "recommendations": ["..."] }`;

/**
 * AI sprint health (Scrum, active sprint) or flow health (Kanban / no sprint).
 * Facts are measured in code from AgiliX tasks and sprints plus GitHub activity
 * from the GitHub MCP server; the LLM judges them and explains its verdict.
 */
@Injectable()
export class SprintHealthService {
  private readonly cache = new Map<string, { at: number; report: SprintHealthReport }>();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly context: TeamContextService,
    private readonly sprints: SprintsService,
    private readonly tasks: TasksService,
    private readonly llm: LlmService,
  ) {}

  async assess(projectId: string, refresh = false): Promise<SprintHealthReport> {
    const cached = this.cache.get(projectId);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
    const ctx = await this.context.build(projectId, 14);

    const facts = await this.measure(projectId, ctx);
    const answer = await this.llm.completeJson({
      task: 'sprint-health',
      system: SYSTEM_PROMPT,
      user: buildPrompt(ctx, facts),
      validate: (value) => validateAnswer(value, facts.mode),
      temperature: 0.2,
      maxTokens: 900,
    });

    const report: SprintHealthReport = {
      project: ctx.project,
      generatedAt: new Date().toISOString(),
      windowDays: ctx.windowDays,
      sources: ctx.sources,
      ...answer,
      facts,
      notes: ctx.notes,
    };
    this.cache.set(projectId, { at: Date.now(), report });
    return report;
  }

  private async measure(projectId: string, ctx: TeamContext): Promise<HealthFacts> {
    const now = Date.now();
    const projectMatch = { $in: [new Types.ObjectId(projectId), projectId] } as never;
    const tasks = (await this.connection
      .model('Task')
      .find({ project: projectMatch })
      .select('status assignee storyPoints sprint startedAt completedAt addedToSprintAt')
      .lean()
      .exec()) as Array<{
      status?: string;
      assignee?: unknown;
      storyPoints?: number;
      sprint?: unknown;
      startedAt?: Date | null;
      completedAt?: Date | null;
      addedToSprintAt?: Date | null;
    }>;

    const team = ctx.members.map((m) => ({
      name: m.name,
      openTasks: m.tasks.open,
      inProgress: m.tasks.inProgress,
      hoursTracked: m.work.hoursTracked,
      lateNightHours: m.work.lateNightHours,
      meetings: m.calendar
        ? {
            hours: m.calendar.meetingHours,
            next7DaysHours: m.calendar.next7Days.meetingHours,
            outOfOfficeDaysNext7: m.calendar.next7Days.outOfOfficeDays,
          }
        : null,
    }));
    const isAgeing = (t: (typeof tasks)[number]) =>
      t.status === 'in_progress' && !!t.startedAt && now - new Date(t.startedAt).getTime() > AGEING_DAYS * DAY_MS;
    const doneSince = (list: typeof tasks, from: number, to = now) =>
      list.filter((t) => t.status === 'done' && t.completedAt && +new Date(t.completedAt) >= from && +new Date(t.completedAt) < to);

    const projectSprints = await this.sprints.findAllForProject(projectId);
    const active = projectSprints.find((s) => s.status === 'active');

    if (active) {
      const sprintId = String(active._id);
      const inSprint = tasks.filter((t) => t.sprint && String(t.sprint) === sprintId);
      const stats = await this.tasks.getSprintStats(sprintId);
      const timing = computeSprintTiming(active, new Date(now));
      const velocity = summarizeVelocity(projectSprints);
      const startedAt = active.startedAt ? new Date(active.startedAt).getTime() : null;

      return {
        mode: 'sprint',
        sprint: {
          id: sprintId,
          name: active.name,
          goal: active.goal ?? '',
          phase: timing.phase,
          elapsedPercent: timing.elapsedPercent,
          elapsedDays: timing.elapsedDays,
          remainingDays: timing.remainingDays,
          tasks: {
            total: stats.total,
            todo: stats.todo,
            inProgress: stats.inProgress,
            review: stats.review,
            done: stats.done,
          },
          storyPoints: { total: stats.totalStoryPoints, done: stats.completedStoryPoints },
          addedAfterStart: startedAt
            ? inSprint.filter((t) => t.addedToSprintAt && +new Date(t.addedToSprintAt) > startedAt + 3_600_000).length
            : 0,
          unassigned: inSprint.filter((t) => !t.assignee && t.status !== 'done').length,
          velocityPerSprint: velocity ? velocity.averagePointsPerSprint : null,
        },
        ageingInProgress: inSprint.filter(isAgeing).length,
        doneLast3Days: doneSince(inSprint, now - 3 * DAY_MS).length,
        github: ctx.githubTeam,
        team,
      };
    }

    // Flow mode: Kanban, or a Scrum project without an active sprint.
    const period = ctx.windowDays * DAY_MS;
    const doneThis = doneSince(tasks, now - period);
    const cycleDays = doneThis
      .filter((t) => t.startedAt && t.completedAt)
      .map((t) => (+new Date(t.completedAt as Date) - +new Date(t.startedAt as Date)) / DAY_MS)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    const median = cycleDays.length ? cycleDays[Math.floor((cycleDays.length - 1) / 2)] : null;

    return {
      mode: 'flow',
      flow: {
        wip: tasks.filter((t) => t.status === 'in_progress').length,
        wipLimit: ctx.project.wipLimit,
        todo: tasks.filter((t) => t.status === 'todo').length,
        inReview: tasks.filter((t) => t.status === 'review').length,
        unassignedOpen: tasks.filter((t) => !t.assignee && t.status !== 'done').length,
        throughputThisPeriod: doneThis.length,
        throughputPreviousPeriod: doneSince(tasks, now - 2 * period, now - period).length,
        medianCycleDays: median === null ? null : round1(median),
      },
      ageingInProgress: tasks.filter(isAgeing).length,
      doneLast3Days: doneSince(tasks, now - 3 * DAY_MS).length,
      github: ctx.githubTeam,
      team,
    };
  }
}

function buildPrompt(ctx: TeamContext, f: HealthFacts): string {
  const lines = [
    `Mode: ${f.mode}`,
    `Project: ${ctx.project.name} (${ctx.project.methodology})`,
    `Today: ${ctx.until.slice(0, 10)}`,
    `Data sources: AgiliX tasks available; GitHub ${ctx.sources.github === 'ok' ? 'available' : `NOT available (${ctx.sources.github})`}; Calendar ${ctx.sources.calendar === 'ok' ? 'available (meeting times only, for people who connected it)' : `NOT available (${ctx.sources.calendar.replace('_', ' ')})`}.`,
    '',
  ];

  if (f.sprint) {
    const s = f.sprint;
    lines.push(
      `Sprint: ${s.name}${s.goal ? ` — goal: ${s.goal}` : ''}`,
      `- Timing: ${s.phase}; ${s.elapsedDays} days elapsed (${s.elapsedPercent}% of the sprint), ${s.remainingDays} days remaining`,
      `- Tasks: ${s.tasks.total} total — To do ${s.tasks.todo}, In progress ${s.tasks.inProgress}, Review ${s.tasks.review}, Done ${s.tasks.done}`,
      `- Story points: ${s.storyPoints.done} of ${s.storyPoints.total} done` + (s.storyPoints.total === 0 ? ' (sprint not estimated; judge by task counts)' : ''),
      `- Tasks added after the sprint started: ${s.addedAfterStart}`,
      `- Unassigned unfinished tasks: ${s.unassigned}`,
      `- Velocity of recent sprints: ${s.velocityPerSprint === null ? 'not available' : `${s.velocityPerSprint} points per sprint`}`,
    );
  }
  if (f.flow) {
    const w = f.flow;
    lines.push(
      'Board flow:',
      `- Work in progress: ${w.wip}${w.wipLimit > 0 ? ` (WIP limit ${w.wipLimit})` : ' (no WIP limit set)'}; To do ${w.todo}; in Review ${w.inReview}`,
      `- Unassigned open tasks: ${w.unassignedOpen}`,
      `- Throughput: ${w.throughputThisPeriod} tasks finished in the last ${ctx.windowDays} days vs ${w.throughputPreviousPeriod} in the ${ctx.windowDays} days before`,
      `- Median cycle time (start to done) of recently finished tasks: ${w.medianCycleDays === null ? 'not available' : `${w.medianCycleDays} days`}`,
    );
  }
  lines.push(
    `- Items in progress for more than ${AGEING_DAYS} days: ${f.ageingInProgress}`,
    `- Tasks finished in the last 3 days: ${f.doneLast3Days}`,
    '',
  );

  if (f.github) {
    const g = f.github;
    lines.push(
      `GitHub (last ${ctx.windowDays} days): ${g.commits} commits; PRs opened ${g.prsOpened}, merged ${g.prsMerged}, open ${g.openPrs} (${g.stalePrs} stale); reviews ${g.reviews}`,
      `- Commits per day: ${g.dailyCommits.map((d) => `${d.date.slice(5)}=${d.commits}`).join(', ')}`,
      '',
    );
  }

  lines.push(`Team load (last ${ctx.windowDays} days):`);
  for (const m of f.team) {
    lines.push(
      `- ${m.name}: ${m.openTasks} open tasks (${m.inProgress} in progress), ${m.hoursTracked} h tracked, ${m.lateNightHours} h late at night; ` +
        (m.meetings
          ? `meetings ${m.meetings.hours} h in the window, ${m.meetings.next7DaysHours} h booked in the next 7 days, ${m.meetings.outOfOfficeDaysNext7} out-of-office days in the next 7 days`
          : 'meetings unknown (no calendar connected)'),
    );
  }
  return lines.join('\n');
}

function validateAnswer(
  value: unknown,
  mode: HealthFacts['mode'],
): Pick<SprintHealthReport, 'status' | 'score' | 'completionForecastPercent' | 'summary' | 'risks' | 'recommendations'> {
  if (!value || typeof value !== 'object') throw new LlmValidationError('answer is not an object');
  const v = value as Record<string, unknown>;

  const status = String(v.status ?? '').toLowerCase().replace(/[\s-]+/g, '_') as HealthStatus;
  if (!STATUSES.includes(status)) throw new LlmValidationError('status is not healthy, at_risk or critical');

  const score = Number(v.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new LlmValidationError('score out of range');

  let completionForecastPercent: number | null = null;
  if (mode === 'sprint') {
    const forecast = Number(v.completionForecastPercent);
    if (!Number.isFinite(forecast) || forecast < 0 || forecast > 100) {
      throw new LlmValidationError('completionForecastPercent missing or out of range');
    }
    completionForecastPercent = Math.round(forecast);
  }

  const summary = typeof v.summary === 'string' ? v.summary.trim().slice(0, 700) : '';
  if (!summary) throw new LlmValidationError('summary is missing');

  const list = (x: unknown, max: number) =>
    Array.isArray(x)
      ? x.filter((i): i is string => typeof i === 'string' && !!i.trim()).map((i) => i.trim().slice(0, 300)).slice(0, max)
      : [];
  const recommendations = list(v.recommendations, 4);
  if (!recommendations.length) throw new LlmValidationError('recommendations missing');

  return {
    status,
    score: Math.round(score),
    completionForecastPercent,
    summary,
    risks: list(v.risks, 5),
    recommendations,
  };
}
