import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LlmService, LlmValidationError } from '../../src/ai/llm.service';
import {
  PriorityRecommendationService,
  validatePriorityRecommendation,
} from '../../src/ai/priority-recommendation.service';
import type { ProjectsService } from '../../src/projects/projects.service';
import type { TasksService } from '../../src/tasks/tasks.service';
import {
  captureLogs,
  createLlmService,
  fakeLlm,
  httpError,
  mockOpenRouter,
  networkError,
  openRouterReply,
} from './test-helpers';

const PROJECT = { _id: 'project-1', name: 'AgiliX', description: 'Agile tool', methodology: 'scrum' };

const PROJECT_TASKS = [
  { _id: 'task-1', title: 'Fix login crash', priority: 'high', status: 'in_progress', updatedAt: '2026-10-05' },
  { _id: 'task-2', title: 'Update footer colour', priority: 'low', status: 'todo', updatedAt: '2026-10-04' },
  { _id: 'task-3', title: 'Shipped feature', priority: 'medium', status: 'done', updatedAt: '2026-10-06' },
];

function setup(llm: LlmService) {
  const projectsService = { findOne: jest.fn().mockResolvedValue(PROJECT) };
  const tasksService = { findAllForProject: jest.fn().mockResolvedValue(PROJECT_TASKS) };
  const service = new PriorityRecommendationService(
    projectsService as unknown as ProjectsService,
    tasksService as unknown as TasksService,
    llm,
  );
  return { service, projectsService, tasksService };
}

describe('AI Priority Recommendation', () => {
  beforeEach(() => {
    captureLogs();
  });

  describe('validatePriorityRecommendation', () => {
    it.each(['low', 'medium', 'high'])('accepts "%s"', (priority) => {
      expect(validatePriorityRecommendation({ priority, reasoning: 'Because.' })).toEqual({
        priority,
        reasoning: 'Because.',
      });
    });

    it('tolerates letter case and spaces, trims reasoning and drops extra fields', () => {
      expect(
        validatePriorityRecommendation({ priority: ' High ', reasoning: '  Blocks users. ', confidence: 0.9 }),
      ).toEqual({ priority: 'high', reasoning: 'Blocks users.' });
    });

    it('limits reasoning to 600 characters', () => {
      const result = validatePriorityRecommendation({ priority: 'low', reasoning: 'y'.repeat(900) });

      expect(result.reasoning).toHaveLength(600);
    });

    it.each(['urgent', 'critical', 'P1', '', 1, null, undefined])('rejects priority %p', (priority) => {
      expect(() => validatePriorityRecommendation({ priority, reasoning: 'ok' })).toThrow(LlmValidationError);
    });

    it.each(['', '   ', null, 42])('rejects empty or missing reasoning %p', (reasoning) => {
      expect(() => validatePriorityRecommendation({ priority: 'low', reasoning })).toThrow(
        'reasoning must be a non-empty string',
      );
    });

    it.each([null, 'high', ['high']])('rejects a non-object response %p', (value) => {
      expect(() => validatePriorityRecommendation(value)).toThrow(LlmValidationError);
    });
  });

  describe('PriorityRecommendationService', () => {
    it('returns a valid recommendation', async () => {
      const { llm, completeJson } = fakeLlm({ priority: 'medium', reasoning: 'Useful, not urgent.' });
      const { service } = setup(llm);

      await expect(
        service.recommend({ title: 'Add export button', description: 'CSV export', project: 'project-1' }),
      ).resolves.toEqual({ priority: 'medium', reasoning: 'Useful, not urgent.' });
      expect(completeJson.mock.calls[0][0]).toMatchObject({ task: 'priority', temperature: 0.1 });
    });

    it('never sends the existing task as its own reference, and leaves out done tasks', async () => {
      const { llm, completeJson } = fakeLlm({ priority: 'high', reasoning: 'Crash.' });
      const { service } = setup(llm);

      await service.recommend({ title: 'Fix login crash', project: 'project-1', taskId: 'task-1' });

      const prompt = completeJson.mock.calls[0][0].user;
      expect(prompt).toContain('Title: Fix login crash');
      expect(prompt).toContain('Status: in progress');
      expect(prompt).not.toContain('"Fix login crash" → high');
      expect(prompt).toContain('- "Update footer colour" → low (todo)');
      expect(prompt).not.toContain('Shipped feature');
      expect(prompt).toContain('Description: (no description provided)');
    });

    it('passes on 404 for an unknown project without calling the AI', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, projectsService } = setup(llm);
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project not found'));

      await expect(service.recommend({ title: 'Task', project: 'missing' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('works end to end through the real LlmService', async () => {
      mockOpenRouter(openRouterReply('{"priority":"HIGH","reasoning":"Blocks every user."}'));
      const { service } = setup(createLlmService());

      await expect(service.recommend({ title: 'Fix login crash', project: 'project-1' })).resolves.toEqual({
        priority: 'high',
        reasoning: 'Blocks every user.',
      });
    });

    it('returns 503 when the models only give invalid priorities', async () => {
      mockOpenRouter(
        openRouterReply('{"priority":"urgent","reasoning":"x"}'),
        openRouterReply('{"priority":"high","reasoning":""}'),
      );
      const { service } = setup(createLlmService());

      await expect(service.recommend({ title: 'Task', project: 'project-1' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('returns 503 when the AI provider fails', async () => {
      mockOpenRouter(httpError(500), networkError('ECONNRESET'));
      const { service } = setup(createLlmService());

      await expect(service.recommend({ title: 'Task', project: 'project-1' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});