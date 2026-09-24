import { Injectable } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { SprintsService } from '../sprints/sprints.service';
import { LlmService, LlmValidationError } from './llm.service';

export type RiskLevel = 'green' | 'yellow' | 'red';

export interface SprintRiskResult {
  risk: RiskLevel;
  reasoning: string;
  completionForecastPercent: number;
}

const RISK_LEVELS: readonly RiskLevel[] = ['green', 'yellow', 'red'];
const MAX_REASONING_LENGTH = 1000;
const DAY_MS = 86400000;

const SPRINT_RISK_SYSTEM_PROMPT = `You are an experienced Agile coach assessing whether a Scrum sprint will deliver its planned work by its end date.

Base your assessment ONLY on the sprint data you are given. Do not invent facts, team members, blockers or history that are not in the data.

Risk levels:
- "green": on track — the remaining work fits comfortably in the remaining time.
- "yellow": at risk — completion is possible but only if progress speeds up or scope is adjusted.
- "red": off track — the planned work is unlikely to be completed by the end date.

How to read the data:
- Story points may be missing. If total story points are 0, the tasks have not been estimated: judge progress from task counts only and do not treat 0 points as "no work".
- Velocity may be missing. If velocity is "not recorded", there is no historical baseline: do not assume the team is slow or fast, judge from progress versus time elapsed.
- If the sprint has no tasks, say so in the reasoning; there is nothing to complete yet.
- If the sprint has not started yet or has already ended, take that into account.

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

  async predictSprintRisk(sprintId: string): Promise<SprintRiskResult> {
    const sprint = await this.sprintsService.findOne(sprintId);
    const stats = await this.tasksService.getSprintStats(sprintId);

    const now = new Date();
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);

    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    const daysElapsed = Math.max(0, Math.round((now.getTime() - start.getTime()) / DAY_MS));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);

    let timing = 'in progress';
    if (now < start) timing = 'not started yet';
    else if (now > end) timing = 'end date has passed';

    const storyPointLines =
      stats.totalStoryPoints > 0
        ? [
            `- Total: ${stats.totalStoryPoints}`,
            `- Completed: ${stats.completedStoryPoints}`,
            '- Note: tasks without an estimate count as 0 points, so totals may understate the scope.',
          ]
        : ['- Not estimated (all tasks have 0 story points) — use task counts instead.'];

    // teamVelocity is stored as story points per day (see sprint.schema.ts).
    const velocityLine =
      sprint.teamVelocity > 0
        ? `${sprint.teamVelocity} story points per day (historical)`
        : 'not recorded';

    const userPrompt = [
      `Sprint: ${sprint.name}`,
      `Status: ${sprint.status}`,
      `Timing: ${timing}`,
      '',
      'Schedule (days):',
      `- Total: ${totalDays}`,
      `- Elapsed: ${Math.min(daysElapsed, totalDays)}`,
      `- Remaining: ${daysRemaining}`,
      '',
      'Tasks:',
      `- Total: ${stats.total}`,
      `- Done: ${stats.done}`,
      `- In progress: ${stats.inProgress}`,
      `- To do: ${stats.todo}`,
      '',
      'Story points:',
      ...storyPointLines,
      '',
      `Team velocity: ${velocityLine}`,
    ].join('\n');

    return this.llm.completeJson<SprintRiskResult>({
      task: 'sprint-risk',
      system: SPRINT_RISK_SYSTEM_PROMPT,
      user: userPrompt,
      validate: validateSprintRisk,
      temperature: 0.2,
    });
  }
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