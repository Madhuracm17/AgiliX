import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  AiService,
  ProjectSprintRecord,
  SprintRiskSprint,
  SprintTaskStats,
  buildSprintRiskPrompt,
  computeSprintTiming,
  summarizeVelocity,
  validateSprintRisk,
} from '../../src/ai/ai.service';
import { LlmService, LlmValidationError } from '../../src/ai/llm.service';
import { SprintStatus } from '../../src/sprints/schemas/sprint.schema';
import type { SprintsService } from '../../src/sprints/sprints.service';
import type { TasksService } from '../../src/tasks/tasks.service';
import {
  captureError,
  captureLogs,
  createLlmService,
  fakeLlm,
  mockOpenRouter,
  openRouterReply,
} from './test-helpers';

const NOW = new Date('2026-10-08T06:00:00.000Z');

/** Active sprint planned Oct 1–14, actually started Oct 2 at 06:00 UTC. */
const ACTIVE_SPRINT: SprintRiskSprint = {
  name: 'Login page',
  status: SprintStatus.ACTIVE,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-14T00:00:00.000Z'),
  startedAt: new Date('2026-10-02T06:00:00.000Z'),
};

const STATS: SprintTaskStats = {
  total: 10,
  todo: 2,
  inProgress: 3,
  review: 2,
  done: 3,
  totalStoryPoints: 30,
  completedStoryPoints: 8,
};

function completedSprint(
  name: string,
  points: number | null,
  startedAt: string,
  completedAt: string,
): ProjectSprintRecord {
  return {
    name,
    status: SprintStatus.COMPLETED,
    startDate: new Date(startedAt),
    endDate: new Date(completedAt),
    startedAt: new Date(startedAt),
    completedAt: new Date(completedAt),
    completedStoryPoints: points,
  };
}

/** Four completed 10-day sprints; the newest three average 20 points (2 per day). */
const HISTORY: ProjectSprintRecord[] = [
  completedSprint('S1', 10, '2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z'),
  completedSprint('S2', 20, '2026-08-15T00:00:00Z', '2026-08-25T00:00:00Z'),
  completedSprint('S3', 10, '2026-09-01T00:00:00Z', '2026-09-11T00:00:00Z'),
  completedSprint('S4', 30, '2026-09-15T00:00:00Z', '2026-09-25T00:00:00Z'),
];

function prompt(overrides: { sprint?: SprintRiskSprint; stats?: SprintTaskStats; history?: ProjectSprintRecord[] } = {}) {
  return buildSprintRiskPrompt({
    sprint: overrides.sprint ?? ACTIVE_SPRINT,
    stats: overrides.stats ?? STATS,
    projectSprints: overrides.history ?? [],
    now: NOW,
  });
}

describe('AI Sprint Risk', () => {
  beforeEach(() => {
    captureLogs();
  });

  describe('task statuses in the prompt', () => {
    it('includes todo, in_progress, review and done counts separately', () => {
      const text = prompt();

      expect(text).toContain('- Total: 10');
      expect(text).toContain('- To do: 2');
      expect(text).toContain('- In progress: 3');
      expect(text).toContain('- Review (finished, waiting to be checked): 2');
      expect(text).toContain('- Done: 3');
    });

    it('does not count review tasks as done', () => {
      expect(prompt()).toContain('- Not done yet: 7 (30% of tasks done)');
    });

    it('handles a sprint without tasks', () => {
      const empty = { total: 0, todo: 0, inProgress: 0, review: 0, done: 0, totalStoryPoints: 0, completedStoryPoints: 0 };

      const text = prompt({ stats: empty });

      expect(text).toContain('- Total: 0');
      expect(text).toContain('- Not done yet: 0\n');
    });
  });

  describe('story points', () => {
    it('reports total, completed (with %) and remaining points', () => {
      const text = prompt();

      expect(text).toContain('- Total: 30');
      expect(text).toContain('- Completed: 8 (27%)');
      expect(text).toContain('- Remaining: 22\n');
    });

    it('tells the model to use task counts when nothing is estimated', () => {
      const text = prompt({ stats: { ...STATS, totalStoryPoints: 0, completedStoryPoints: 0 } });

      expect(text).toContain('Not estimated (all tasks have 0 story points)');
      expect(text).not.toContain('- Completed:');
    });
  });

  describe('timing', () => {
    it('measures an active sprint from its actual start (startedAt)', () => {
      const timing = computeSprintTiming(ACTIVE_SPRINT, NOW);

      expect(timing.startBasis).toBe('actual');
      expect(timing.phase).toBe('in-progress');
      expect(timing.deadline.toISOString()).toBe('2026-10-15T00:00:00.000Z'); // end of the last day
      expect(timing.totalDays).toBe(12.8);
      expect(timing.elapsedDays).toBe(6);
      expect(timing.remainingDays).toBe(6.8);
      expect(timing.elapsedPercent).toBe(47);
      expect(prompt()).toContain('- Actual start: 2026-10-02T06:00:00.000Z');
    });

    it('falls back to the planned start when an active sprint has no startedAt', () => {
      const sprint = { ...ACTIVE_SPRINT, startedAt: null };

      const timing = computeSprintTiming(sprint, NOW);

      expect(timing.startBasis).toBe('planned');
      expect(timing.totalDays).toBe(14);
      expect(prompt({ sprint })).toContain('- Actual start: not recorded');
    });

    it('measures a planned (not started) sprint from its planned dates', () => {
      const planned = {
        ...ACTIVE_SPRINT,
        status: SprintStatus.PLANNED,
        startedAt: null,
        startDate: new Date('2026-10-15T00:00:00.000Z'),
        endDate: new Date('2026-10-28T00:00:00.000Z'),
      };

      const timing = computeSprintTiming(planned, NOW);

      expect(timing.phase).toBe('not-started');
      expect(timing.startBasis).toBe('planned');
      expect(timing.elapsedDays).toBe(0);
      expect(timing.remainingDays).toBe(14);
      expect(timing.elapsedPercent).toBe(0);
      expect(prompt({ sprint: planned })).toContain('Timing: not started yet');
    });

    it('notes a planned sprint whose end date has already passed', () => {
      const late = { ...ACTIVE_SPRINT, status: SprintStatus.PLANNED, startedAt: null };

      const text = buildSprintRiskPrompt({
        sprint: late,
        stats: STATS,
        projectSprints: [],
        now: new Date('2026-10-20T00:00:00.000Z'),
      });

      expect(text).toContain('the planned end date has already passed');
    });

    it('reports an active sprint that is past its end date', () => {
      const timing = computeSprintTiming(ACTIVE_SPRINT, new Date('2026-10-20T00:00:00.000Z'));

      expect(timing.phase).toBe('past-end-date');
      expect(timing.remainingDays).toBe(0);
      expect(timing.elapsedPercent).toBe(100);
    });

    it('handles a sprint started after its end date without dividing by zero', () => {
      const sprint = { ...ACTIVE_SPRINT, startedAt: new Date('2026-10-16T00:00:00.000Z') };

      const timing = computeSprintTiming(sprint, new Date('2026-10-17T00:00:00.000Z'));

      expect(timing.totalDays).toBe(0);
      expect(timing.elapsedPercent).toBe(100);
    });

    it('rejects invalid sprint dates with 400', () => {
      const badStart = { ...ACTIVE_SPRINT, startDate: new Date('not a date') };
      const badEnd = { ...ACTIVE_SPRINT, endDate: new Date('not a date') };

      expect(() => computeSprintTiming(badStart, NOW)).toThrow(BadRequestException);
      expect(() => computeSprintTiming(badEnd, NOW)).toThrow('This sprint has invalid dates');
    });
  });

  describe('velocity from completed sprints', () => {
    it('averages the three most recent completed sprints using their actual length', () => {
      const velocity = summarizeVelocity(HISTORY);

      expect(velocity?.samples.map((s) => s.name)).toEqual(['S4', 'S3', 'S2']);
      expect(velocity?.samples.map((s) => s.days)).toEqual([10, 10, 10]);
      expect(velocity?.averagePointsPerSprint).toBe(20);
      expect(velocity?.averagePointsPerDay).toBe(2);
    });

    it('uses the planned length when actual start/completion times are missing', () => {
      const sprint: ProjectSprintRecord = {
        name: 'Old sprint',
        status: SprintStatus.COMPLETED,
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-09-10T00:00:00Z'),
        startedAt: null,
        completedAt: null,
        completedStoryPoints: 20,
      };

      const velocity = summarizeVelocity([sprint]);

      expect(velocity?.samples[0].days).toBe(10);
      expect(velocity?.averagePointsPerDay).toBe(2);
    });

    it('never treats a sprint as shorter than one day', () => {
      const quick = completedSprint('Quick', 5, '2026-09-01T00:00:00Z', '2026-09-01T02:00:00Z');

      expect(summarizeVelocity([quick])?.samples[0].days).toBe(1);
    });

    it('ignores sprints that are not completed or have no recorded points', () => {
      const active: ProjectSprintRecord = { ...completedSprint('Active', 50, '2026-10-01', '2026-10-14'), status: SprintStatus.ACTIVE };
      const noPoints = completedSprint('No points', null, '2026-09-01', '2026-09-11');

      expect(summarizeVelocity([active, noPoints])).toBeNull();
    });

    it('returns null when completed sprints delivered zero points', () => {
      expect(summarizeVelocity([completedSprint('Zero', 0, '2026-09-01', '2026-09-11')])).toBeNull();
    });

    it('compares the historical pace with the remaining work in the prompt', () => {
      const text = prompt({ history: HISTORY });

      expect(text).toContain('- Average: 20 story points per sprint (2 per day)');
      expect(text).toContain(
        '- At that pace about 13.6 story points can be completed in the 6.8 remaining days; 22 story points remain.',
      );
    });

    it('says velocity is not available when there is no history', () => {
      expect(prompt()).toContain('Velocity:\n- Not available');
    });

    it('does not compare velocity with an unestimated sprint', () => {
      const text = prompt({ history: HISTORY, stats: { ...STATS, totalStoryPoints: 0, completedStoryPoints: 0 } });

      expect(text).toContain('velocity cannot be compared with its remaining work');
    });

    it('ignores the unused Sprint.teamVelocity field', () => {
      const sprint = { ...ACTIVE_SPRINT, teamVelocity: 987 } as SprintRiskSprint;

      expect(prompt({ sprint })).not.toContain('987');
      expect(prompt({ sprint })).toContain('Velocity:\n- Not available');
    });
  });

  describe('validateSprintRisk', () => {
    it('accepts a valid verdict and returns exactly the response contract', () => {
      expect(
        validateSprintRisk({ risk: 'Yellow', reasoning: '  7 of 10 tasks remain. ', completionForecastPercent: '72.6%', extra: 1 }),
      ).toEqual({ risk: 'yellow', reasoning: '7 of 10 tasks remain.', completionForecastPercent: 73 });
    });

    it('limits reasoning to 1000 characters', () => {
      const result = validateSprintRisk({ risk: 'red', reasoning: 'x'.repeat(1500), completionForecastPercent: 10 });

      expect(result.reasoning).toHaveLength(1000);
    });

    it.each([
      ['a non-object', 'green'],
      ['an array', []],
      ['null', null],
      ['an unknown risk level', { risk: 'orange', reasoning: 'ok', completionForecastPercent: 50 }],
      ['empty reasoning', { risk: 'green', reasoning: '   ', completionForecastPercent: 50 }],
      ['a percentage above 100', { risk: 'green', reasoning: 'ok', completionForecastPercent: 150 }],
      ['a negative percentage', { risk: 'green', reasoning: 'ok', completionForecastPercent: -1 }],
      ['a non-numeric percentage', { risk: 'green', reasoning: 'ok', completionForecastPercent: 'high' }],
      ['a missing percentage', { risk: 'green', reasoning: 'ok' }],
    ])('rejects %s', (_label, value) => {
      expect(() => validateSprintRisk(value)).toThrow(LlmValidationError);
    });
  });

  describe('AiService.predictSprintRisk', () => {
    function setup(sprint: Record<string, unknown>, llm: LlmService) {
      const sprintsService = {
        findOne: jest.fn().mockResolvedValue(sprint),
        findAllForProject: jest.fn().mockResolvedValue(HISTORY),
      };
      const tasksService = { getSprintStats: jest.fn().mockResolvedValue(STATS) };
      const service = new AiService(
        tasksService as unknown as TasksService,
        sprintsService as unknown as SprintsService,
        llm,
      );
      return { service, sprintsService, tasksService };
    }

    const storedSprint = { ...ACTIVE_SPRINT, _id: 'sprint-1', project: 'project-1' };

    it('rejects a completed sprint with 400 before reading tasks or calling the AI', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, tasksService, sprintsService } = setup(
        { ...storedSprint, status: SprintStatus.COMPLETED },
        llm,
      );

      const error = await captureError(service.predictSprintRisk('sprint-1'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/already completed/);
      expect(tasksService.getSprintStats).not.toHaveBeenCalled();
      expect(sprintsService.findAllForProject).not.toHaveBeenCalled();
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('passes on 404 for an unknown sprint', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, sprintsService } = setup(storedSprint, llm);
      sprintsService.findOne.mockRejectedValue(new NotFoundException('Sprint not found'));

      await expect(service.predictSprintRisk('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('sends the sprint data to the shared LlmService and returns the verdict', async () => {
      const { llm, completeJson } = fakeLlm({ risk: 'green', reasoning: 'On track.', completionForecastPercent: 90 });
      const { service, sprintsService, tasksService } = setup(storedSprint, llm);

      const result = await service.predictSprintRisk('sprint-1');

      expect(result).toEqual({ risk: 'green', reasoning: 'On track.', completionForecastPercent: 90 });
      expect(tasksService.getSprintStats).toHaveBeenCalledWith('sprint-1');
      expect(sprintsService.findAllForProject).toHaveBeenCalledWith('project-1');
      const options = completeJson.mock.calls[0][0];
      expect(options.task).toBe('sprint-risk');
      expect(options.temperature).toBe(0.2);
      expect(options.user).toContain('- Review (finished, waiting to be checked): 2');
      expect(options.user).toContain('- Average: 20 story points per sprint');
    });

    it('returns the verdict end to end through the real LlmService', async () => {
      mockOpenRouter(
        openRouterReply('```json\n{"risk":"Yellow","reasoning":"Behind schedule.","completionForecastPercent":"72%"}\n```'),
      );
      const { service } = setup(storedSprint, createLlmService());

      await expect(service.predictSprintRisk('sprint-1')).resolves.toEqual({
        risk: 'yellow',
        reasoning: 'Behind schedule.',
        completionForecastPercent: 72,
      });
    });

    it('returns 503 when every model gives an invalid verdict (nothing is invented)', async () => {
      const post = mockOpenRouter(
        openRouterReply('{"risk":"orange","reasoning":"x","completionForecastPercent":50}'),
        openRouterReply('{"risk":"red","reasoning":"x","completionForecastPercent":150}'),
      );
      const { service } = setup(storedSprint, createLlmService());

      await expect(service.predictSprintRisk('sprint-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(post).toHaveBeenCalledTimes(2);
    });
  });
});