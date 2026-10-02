import { BadRequestException, Injectable } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { SprintsService } from '../sprints/sprints.service';
import { Sprint, SprintStatus } from '../sprints/schemas/sprint.schema';
import { LlmService, LlmValidationError } from './llm.service';

export type RiskLevel = 'green' | 'yellow' | 'red';

export interface SprintRiskResult {
  risk: RiskLevel;
  reasoning: string;
  completionForecastPercent: number;
}

/** The sprint fields Sprint Risk reads (all of them already exist on the Sprint schema). */
export type SprintRiskSprint = Pick<
  Sprint,
  'name' | 'status' | 'startDate' | 'endDate' | 'startedAt'
>;

/** A sprint of the same project, as returned by SprintsService.findAllForProject. */
export type ProjectSprintRecord = Pick<
  Sprint,
  'name' | 'status' | 'startDate' | 'endDate' | 'startedAt' | 'completedAt' | 'completedStoryPoints'
>;

/** Same shape as TasksService.getSprintStats (statuses come from the TaskStatus enum). */
export interface SprintTaskStats {
  total: number;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
}

export interface SprintRiskInput {
  sprint: SprintRiskSprint;
  stats: SprintTaskStats;
  /** Every sprint of the project; only completed ones with recorded points are used for velocity. */
  projectSprints: ProjectSprintRecord[];
  now: Date;
}

export interface SprintTiming {
  /** planned sprint → not-started; active sprint → in-progress or past-end-date. */
  phase: 'not-started' | 'in-progress' | 'past-end-date';
  plannedStart: Date;
  plannedEnd: Date;
  /** End of the sprint's last day (endDate is the last working day, stored as midnight UTC). */
  deadline: Date;
  /** Sprint.startedAt, when it was recorded. */
  actualStart: Date | null;
  /** Which start the day counts are measured from. */
  startBasis: 'actual' | 'planned';
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  elapsedPercent: number;
}

export interface VelocitySample {
  name: string;
  completedStoryPoints: number;
  days: number;
}

export interface VelocitySummary {
  samples: VelocitySample[];
  averagePointsPerSprint: number;
  averagePointsPerDay: number;
}

const RISK_LEVELS: readonly RiskLevel[] = ['green', 'yellow', 'red'];
const MAX_REASONING_LENGTH = 1000;
const DAY_MS = 86400000;
/** How many recent completed sprints are used as the velocity baseline. */
const VELOCITY_SPRINT_LIMIT = 3;

const COMPLETED_SPRINT_MESSAGE =
  'This sprint is already completed, so there is no remaining work to assess. ' +
  'AI Sprint Risk is available for planned and active sprints only.';

const SPRINT_RISK_SYSTEM_PROMPT = `You are an experienced Agile coach assessing whether a Scrum sprint will deliver its planned work by its end date.

Base your assessment ONLY on the sprint data you are given. Do not invent facts, team members, blockers or history that are not in the data. All counts, days, percentages and velocity figures have already been calculated for you: use them as given and do not recalculate them.

Risk levels:
- "green": on track — the remaining work fits comfortably in the remaining time.
- "yellow": at risk — completion is possible but only if progress speeds up or scope is adjusted.
- "red": off track — the planned work is unlikely to be completed by the end date.

How to read the data:
- Task statuses: "To do" = not started; "In progress" = being worked on; "Review" = the work is finished and waiting to be checked, so it is close to done but NOT done yet; "Done" = completed. Only Done work counts as delivered.
- Story points may be missing. If the sprint is not estimated, judge progress from task counts only and do not treat 0 points as "no work". Tasks without an estimate count as 0 points, so story-point totals may understate the scope.
- Timing compares how much of the sprint's time has been used with how much work is done. Days are calendar days.
- Velocity is the team's recorded pace in recent completed sprints. If it is "not available", there is no historical baseline: do not assume the team is slow or fast, judge from progress versus time elapsed. Velocity is a guide from the past, not a guarantee.
- If the sprint has no tasks, say so in the reasoning; there is nothing to complete yet.
- If the sprint has not started yet, or its end date has already passed, take that into account.

Respond with a single JSON object and nothing else — no markdown, no extra text. It must have exactly these fields:
- "risk": one of "green", "yellow", "red"
- "reasoning": 1 to 3 plain sentences explaining the verdict, referring to the actual numbers
- "completionForecastPercent": an integer from 0 to 100, the percentage of the sprint's planned work you expect to be done by the end date`;

@Injectable()
export class AiService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly sprintsService: SprintsService,
    private readonly llm: LlmService,
  ) {}

  /**
   * AI completion-risk verdict for a planned or active sprint.
   * Throws 400 for a completed sprint (nothing left to forecast), 404 for an
   * unknown sprint and 503 if no AI model returns a valid verdict.
   */
  async predictSprintRisk(sprintId: string): Promise<SprintRiskResult> {
    const sprint = await this.sprintsService.findOne(sprintId);
    if (sprint.status === SprintStatus.COMPLETED) {
      throw new BadRequestException(COMPLETED_SPRINT_MESSAGE);
    }

    // Velocity comes from the committed/completed story points that
    // SprintsService.complete() already records on each completed sprint.
    // When the Scrum velocity service exists, read it here instead.
    const [stats, projectSprints] = await Promise.all([
      this.tasksService.getSprintStats(sprintId),
      this.sprintsService.findAllForProject(String(sprint.project)),
    ]);

    return this.llm.completeJson<SprintRiskResult>({
      task: 'sprint-risk',
      system: SPRINT_RISK_SYSTEM_PROMPT,
      user: buildSprintRiskPrompt({ sprint, stats, projectSprints, now: new Date() }),
      validate: validateSprintRisk,
      temperature: 0.2,
    });
  }
}

/**
 * Time figures for the forecast. An active sprint is measured from when it was
 * actually started (Sprint.startedAt); a planned sprint, or an active one whose
 * start time was never recorded, from its planned startDate.
 */
export function computeSprintTiming(sprint: SprintRiskSprint, now: Date): SprintTiming {
  const plannedStart = toValidDate(sprint.startDate);
  const plannedEnd = toValidDate(sprint.endDate);
  if (!plannedStart || !plannedEnd) {
    throw new BadRequestException('This sprint has invalid dates');
  }

  const deadline = new Date(plannedEnd.getTime() + DAY_MS);
  const actualStart = toValidDate(sprint.startedAt);
  const isActive = sprint.status === SprintStatus.ACTIVE;
  const startBasis = isActive && actualStart ? 'actual' : 'planned';
  const start = startBasis === 'actual' && actualStart ? actualStart : plannedStart;

  const totalMs = Math.max(0, deadline.getTime() - start.getTime());
  const elapsedMs = Math.min(totalMs, Math.max(0, now.getTime() - start.getTime()));

  let phase: SprintTiming['phase'] = 'not-started';
  if (isActive) phase = now.getTime() >= deadline.getTime() ? 'past-end-date' : 'in-progress';

  return {
    phase,
    plannedStart,
    plannedEnd,
    deadline,
    actualStart,
    startBasis,
    totalDays: roundTo1(totalMs / DAY_MS),
    elapsedDays: roundTo1(elapsedMs / DAY_MS),
    remainingDays: roundTo1((totalMs - elapsedMs) / DAY_MS),
    elapsedPercent: totalMs > 0 ? Math.round((elapsedMs / totalMs) * 100) : 100,
  };
}

/**
 * Pace of the most recent completed sprints, from the completedStoryPoints
 * snapshot SprintsService.complete() stores. Returns null when there is no
 * usable history (no completed sprints, or none completed any points).
 */
export function summarizeVelocity(projectSprints: ProjectSprintRecord[]): VelocitySummary | null {
  const samples = projectSprints
    .filter(
      (s) =>
        s.status === SprintStatus.COMPLETED &&
        typeof s.completedStoryPoints === 'number' &&
        Number.isFinite(s.completedStoryPoints),
    )
    .sort((a, b) => completionTime(b) - completionTime(a))
    .slice(0, VELOCITY_SPRINT_LIMIT)
    .map(
      (s): VelocitySample => ({
        name: s.name,
        completedStoryPoints: s.completedStoryPoints as number,
        days: sprintLengthDays(s),
      }),
    );

  const totalPoints = samples.reduce((sum, s) => sum + s.completedStoryPoints, 0);
  if (!samples.length || totalPoints <= 0) return null;

  const totalDays = samples.reduce((sum, s) => sum + s.days, 0);
  return {
    samples,
    averagePointsPerSprint: roundTo1(totalPoints / samples.length),
    averagePointsPerDay: roundTo1(totalPoints / totalDays),
  };
}

/** The user prompt: every figure the model needs, already calculated. */
export function buildSprintRiskPrompt(input: SprintRiskInput): string {
  const { sprint, stats, now } = input;
  const timing = computeSprintTiming(sprint, now);
  const velocity = summarizeVelocity(input.projectSprints);

  const estimated = stats.totalStoryPoints > 0;
  const remainingPoints = Math.max(0, stats.totalStoryPoints - stats.completedStoryPoints);
  const notDone = Math.max(0, stats.total - stats.done);

  const timingLabel = {
    'not-started': 'not started yet (sprint status is planned)',
    'in-progress': 'in progress',
    'past-end-date': 'the end date has passed but the sprint is still active',
  }[timing.phase];

  let startLine: string;
  if (timing.actualStart && timing.startBasis === 'actual') {
    startLine = `- Actual start: ${timing.actualStart.toISOString()} (days below are measured from here)`;
  } else if (timing.phase === 'not-started') {
    startLine = '- Actual start: not started yet (days below are measured from the planned start date)';
  } else {
    startLine =
      '- Actual start: not recorded (days below are measured from the planned start date)';
  }

  const lines = [
    `Sprint: ${sprint.name}`,
    `Status: ${sprint.status}`,
    `Timing: ${timingLabel}`,
    `Current date/time (UTC): ${now.toISOString()}`,
    '',
    'Schedule:',
    `- Planned dates: ${formatDay(timing.plannedStart)} to ${formatDay(timing.plannedEnd)} (the end date is the last day of the sprint)`,
    startLine,
    `- Total: ${timing.totalDays} days`,
    `- Elapsed: ${timing.elapsedDays} days (${timing.elapsedPercent}% of the sprint's time)`,
    `- Remaining: ${timing.remainingDays} days`,
    ...(timing.phase === 'not-started' && now.getTime() >= timing.deadline.getTime()
      ? ['- Note: the planned end date has already passed although the sprint was never started.']
      : []),
    '',
    'Tasks:',
    `- Total: ${stats.total}`,
    `- To do: ${stats.todo}`,
    `- In progress: ${stats.inProgress}`,
    `- Review (finished, waiting to be checked): ${stats.review}`,
    `- Done: ${stats.done}`,
    `- Not done yet: ${notDone}${stats.total ? ` (${Math.round((stats.done / stats.total) * 100)}% of tasks done)` : ''}`,
    '',
    'Story points:',
    ...(estimated
      ? [
          `- Total: ${stats.totalStoryPoints}`,
          `- Completed: ${stats.completedStoryPoints} (${Math.round((stats.completedStoryPoints / stats.totalStoryPoints) * 100)}%)`,
          `- Remaining: ${remainingPoints}`,
          '- Note: tasks without an estimate count as 0 points, so totals may understate the scope.',
        ]
      : ['- Not estimated (all tasks have 0 story points) — use task counts instead.']),
    '',
    'Velocity:',
    ...formatVelocity(velocity, estimated, timing, remainingPoints),
  ];

  return lines.join('\n');
}

function formatVelocity(
  velocity: VelocitySummary | null,
  estimated: boolean,
  timing: SprintTiming,
  remainingPoints: number,
): string[] {
  if (!velocity) {
    return ['- Not available: the project has no completed sprints with completed story points yet.'];
  }

  const lines = [
    `- Recent completed sprints: ${velocity.samples
      .map((s) => `"${s.name}" ${s.completedStoryPoints} points in ${s.days} days`)
      .join('; ')}`,
    `- Average: ${velocity.averagePointsPerSprint} story points per sprint (${velocity.averagePointsPerDay} per day)`,
  ];

  if (!estimated) {
    lines.push('- This sprint is not estimated, so velocity cannot be compared with its remaining work.');
  } else if (timing.remainingDays > 0) {
    const projected = roundTo1(velocity.averagePointsPerDay * timing.remainingDays);
    lines.push(
      `- At that pace about ${projected} story points can be completed in the ${timing.remainingDays} remaining days; ${remainingPoints} story points remain.`,
    );
  }
  return lines;
}

/** Actual length (startedAt → completedAt) when recorded, otherwise the planned length. Never below 1 day. */
function sprintLengthDays(sprint: ProjectSprintRecord): number {
  const started = toValidDate(sprint.startedAt);
  const completed = toValidDate(sprint.completedAt);
  let ms: number;
  if (started && completed && completed > started) {
    ms = completed.getTime() - started.getTime();
  } else {
    const start = toValidDate(sprint.startDate);
    const end = toValidDate(sprint.endDate);
    ms = start && end ? end.getTime() + DAY_MS - start.getTime() : DAY_MS;
  }
  return Math.max(1, roundTo1(ms / DAY_MS));
}

function completionTime(sprint: ProjectSprintRecord): number {
  return (toValidDate(sprint.completedAt) ?? toValidDate(sprint.endDate))?.getTime() ?? 0;
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-10-01" — sprint dates are stored as midnight UTC. */
function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Accepts only a well-formed sprint-risk verdict and returns exactly
 * { risk, reasoning, completionForecastPercent } (extra fields dropped).
 */
export function validateSprintRisk(value: unknown): SprintRiskResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LlmValidationError('response is not a JSON object');
  }
  const data = value as Record<string, unknown>;

  const risk = typeof data.risk === 'string' ? data.risk.trim().toLowerCase() : '';
  if (!RISK_LEVELS.includes(risk as RiskLevel)) {
    throw new LlmValidationError('risk must be "green", "yellow" or "red"');
  }

  const reasoning = typeof data.reasoning === 'string' ? data.reasoning.trim() : '';
  if (!reasoning) {
    throw new LlmValidationError('reasoning must be a non-empty string');
  }

  // Tolerate "85" / "85%" from weaker models, but never out-of-range values.
  const rawPercent = data.completionForecastPercent;
  const percent =
    typeof rawPercent === 'number'
      ? rawPercent
      : typeof rawPercent === 'string'
        ? Number(rawPercent.trim().replace(/%$/, ''))
        : NaN;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new LlmValidationError('completionForecastPercent must be a number from 0 to 100');
  }

  return {
    risk: risk as RiskLevel,
    reasoning: reasoning.slice(0, MAX_REASONING_LENGTH),
    completionForecastPercent: Math.round(percent),
  };
}