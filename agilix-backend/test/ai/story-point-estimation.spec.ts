import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LlmService, LlmValidationError } from '../../src/ai/llm.service';
import {
  StoryPointEstimationService,
  validateStoryPointEstimate,
} from '../../src/ai/story-point-estimation.service';
import type { ProjectsService } from '../../src/projects/projects.service';
import type { TasksService } from '../../src/tasks/tasks.service';
import { TaskPriority } from '../../src/tasks/schemas/task.schema';
import { STORY_POINT_SCALE } from '../../src/tasks/story-points';
import {
  captureLogs,
  createLlmService,
  fakeLlm,
  httpError,
  mockOpenRouter,
  openRouterReply,
} from './test-helpers';

const PROJECT = { _id: 'project-1', name: 'AgiliX', methodology: 'kanban' };

const PROJECT_TASKS = [
  { _id: 'task-1', title: 'Login API', storyPoints: 5, updatedAt: '2026-10-05' },
  { _id: 'task-2', title: 'Fix typo', storyPoints: 1, updatedAt: '2026-10-04' },
  { _id: 'task-3', title: 'Not estimated yet', storyPoints: 0, updatedAt: '2026-10-06' },
  { _id: 'task-4', title: 'Legacy off-scale task', storyPoints: 4, updatedAt: '2026-10-07' },
  { _id: 'task-5', title: 'Task being re-estimated', storyPoints: 8, updatedAt: '2026-10-08' },
];

function setup(llm: LlmService, tasks: unknown[] = PROJECT_TASKS) {
  const projectsService = { findOne: jest.fn().mockResolvedValue(PROJECT) };
  const tasksService = { findAllForProject: jest.fn().mockResolvedValue(tasks) };
  const service = new StoryPointEstimationService(
    projectsService as unknown as ProjectsService,
    tasksService as unknown as TasksService,
    llm,
  );
  return { service, projectsService };
}

describe('AI Story Point Estimation', () => {
  beforeEach(() => {
    captureLogs();
  });

  describe('validateStoryPointEstimate', () => {
    it('uses the shared scale 0, 1, 2, 3, 5, 8, 13', () => {
      expect([...STORY_POINT_SCALE]).toEqual([0, 1, 2, 3, 5, 8, 13]);
    });

    it.each([...STORY_POINT_SCALE])('accepts %p story points', (storyPoints) => {
      expect(validateStoryPointEstimate({ storyPoints, reasoning: 'Sized.' })).toEqual({
        storyPoints,
        reasoning: 'Sized.',
      });
    });

    it('accepts a whole number written as a string, and drops extra fields', () => {
      expect(validateStoryPointEstimate({ storyPoints: ' 8 ', reasoning: ' Large. ', extra: true })).toEqual({
        storyPoints: 8,
        reasoning: 'Large.',
      });
    });

    it.each([4, 21, -1, 2.5, 100, '5.0', 'five', '', null, undefined, NaN])(
      'rejects %p (not on the scale, never rounded)',
      (storyPoints) => {
        expect(() => validateStoryPointEstimate({ storyPoints, reasoning: 'ok' })).toThrow(LlmValidationError);
      },
    );

    it.each(['', '   ', null, 5])('rejects empty or missing reasoning %p', (reasoning) => {
      expect(() => validateStoryPointEstimate({ storyPoints: 3, reasoning })).toThrow(
        'reasoning must be a non-empty string',
      );
    });

    it.each([null, 5, [5]])('rejects a non-object response %p', (value) => {
      expect(() => validateStoryPointEstimate(value)).toThrow(LlmValidationError);
    });

    it('limits reasoning to 600 characters', () => {
      const result = validateStoryPointEstimate({ storyPoints: 2, reasoning: 'z'.repeat(800) });

      expect(result.reasoning).toHaveLength(600);
    });
  });

  describe('StoryPointEstimationService', () => {
    it('returns a valid estimate', async () => {
      const { llm, completeJson } = fakeLlm({ storyPoints: 3, reasoning: 'Moderate work.' });
      const { service } = setup(llm);

      await expect(
        service.estimate({ title: 'Add logout', description: 'Button + API', priority: TaskPriority.HIGH, project: 'project-1' }),
      ).resolves.toEqual({ storyPoints: 3, reasoning: 'Moderate work.' });
      expect(completeJson.mock.calls[0][0]).toMatchObject({ task: 'story-points', temperature: 0.1 });
    });

    it('only uses estimated, on-scale tasks as references and never the task itself', async () => {
      const { llm, completeJson } = fakeLlm({ storyPoints: 5, reasoning: 'ok' });
      const { service } = setup(llm);

      await service.estimate({ title: 'Task being re-estimated', project: 'project-1', taskId: 'task-5' });

      const prompt = completeJson.mock.calls[0][0].user;
      expect(prompt).toContain('- "Login API" → 5 points');
      expect(prompt).toContain('- "Fix typo" → 1 point');
      expect(prompt).not.toContain('Not estimated yet');
      expect(prompt).not.toContain('Legacy off-scale task');
      expect(prompt).not.toContain('"Task being re-estimated" →');
      expect(prompt).toContain('Priority: not specified');
      expect(prompt).toContain('Methodology: Kanban');
    });

    it('tells the AI that priority is not size', async () => {
      const { llm, completeJson } = fakeLlm({ storyPoints: 5, reasoning: 'ok' });
      const { service } = setup(llm);

      await service.estimate({ title: 'Task', project: 'project-1', priority: TaskPriority.HIGH });

      expect(completeJson.mock.calls[0][0].user).toContain('Priority: high (business importance only, not size)');
    });

    it('says when there are no reference tasks', async () => {
      const { llm, completeJson } = fakeLlm({ storyPoints: 5, reasoning: 'ok' });
      const { service } = setup(llm, []);

      await service.estimate({ title: 'First task', project: 'project-1' });

      expect(completeJson.mock.calls[0][0].user).toContain('- None. No tasks in this project have been estimated yet.');
    });

    it('passes on 404 for an unknown project without calling the AI', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, projectsService } = setup(llm);
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project not found'));

      await expect(service.estimate({ title: 'Task', project: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('works end to end through the real LlmService', async () => {
      mockOpenRouter(openRouterReply('{"storyPoints": "13", "reasoning": "Very large; split it."}'));
      const { service } = setup(createLlmService());

      await expect(service.estimate({ title: 'Rewrite auth', project: 'project-1' })).resolves.toEqual({
        storyPoints: 13,
        reasoning: 'Very large; split it.',
      });
    });

    it('returns 503 when the models only give off-scale story points', async () => {
      mockOpenRouter(
        openRouterReply('{"storyPoints": 4, "reasoning": "x"}'),
        openRouterReply('{"storyPoints": 20, "reasoning": "x"}'),
      );
      const { service } = setup(createLlmService());

      await expect(service.estimate({ title: 'Task', project: 'project-1' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('returns 503 when the AI provider fails', async () => {
      mockOpenRouter(httpError(503), httpError(500));
      const { service } = setup(createLlmService());

      await expect(service.estimate({ title: 'Task', project: 'project-1' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});