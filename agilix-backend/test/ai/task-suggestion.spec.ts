import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LlmService, LlmValidationError } from '../../src/ai/llm.service';
import {
  TaskSuggestionService,
  ValidationContext,
  validateTaskSuggestions,
} from '../../src/ai/task-suggestion.service';
import type { ProjectsService } from '../../src/projects/projects.service';
import type { TasksService } from '../../src/tasks/tasks.service';
import {
  captureLogs,
  createLlmService,
  fakeLlm,
  httpError,
  mockOpenRouter,
  openRouterReply,
} from './test-helpers';

const BACKLOG = [
  {
    _id: 'b1',
    title: 'Build login page',
    description: 'Email and password form',
    status: 'todo',
    priority: 'high',
    storyPoints: 5,
    updatedAt: '2026-10-02',
  },
  {
    _id: 'b2',
    title: 'Create user registration form',
    description: '',
    status: 'todo',
    priority: 'medium',
    storyPoints: 0,
    updatedAt: '2026-10-01',
  },
];

/** A task that is already in a sprint: used for duplicate checks only, never sent to the AI. */
const SPRINT_TASK = { _id: 's1', title: 'Write API documentation', status: 'in_progress', priority: 'low' };

const CONTEXT: ValidationContext = {
  backlogTitles: BACKLOG.map((t) => t.title),
  existingTitles: [...BACKLOG.map((t) => t.title), SPRINT_TASK.title],
};

function suggestion(title: string, basedOn: string, priority = 'medium') {
  return { title, description: `Do: ${title}.`, priority, basedOn, reasoning: `Follows from ${basedOn}.` };
}

const S1 = suggestion('Add password reset flow', 'Build login page', 'high');
const S2 = suggestion('Validate registration form inputs', 'Create user registration form');
const S3 = suggestion('Add logout button', 'build login page');
const S4 = suggestion('Write login page tests', 'Build login page');
const S5 = suggestion('Add remember me option', 'Build login page', 'low');
const S6 = suggestion('Send registration confirmation email', 'Create user registration form');

const titles = (result: { suggestions: { title: string }[] }) => result.suggestions.map((s) => s.title);

function setup(llm: LlmService) {
  const projectsService = {
    findOne: jest.fn().mockResolvedValue({ _id: 'project-1', name: 'AgiliX', description: 'Agile tool' }),
  };
  const tasksService = {
    findBacklog: jest.fn().mockResolvedValue(BACKLOG),
    findAllForProject: jest.fn().mockResolvedValue([...BACKLOG, SPRINT_TASK]),
  };
  const service = new TaskSuggestionService(
    projectsService as unknown as ProjectsService,
    tasksService as unknown as TasksService,
    llm,
  );
  return { service, projectsService, tasksService };
}

describe('AI Task Suggestions', () => {
  beforeEach(() => {
    captureLogs();
  });

  describe('validateTaskSuggestions', () => {
    it('accepts 3 valid backlog-based suggestions and returns the real backlog titles', () => {
      const result = validateTaskSuggestions({ suggestions: [S1, S2, S3] }, CONTEXT);

      expect(result.suggestions).toEqual([
        { title: S1.title, description: S1.description, priority: 'high', reasoning: S1.reasoning, basedOn: 'Build login page' },
        {
          title: S2.title,
          description: S2.description,
          priority: 'medium',
          reasoning: S2.reasoning,
          basedOn: 'Create user registration form',
        },
        { title: S3.title, description: S3.description, priority: 'medium', reasoning: S3.reasoning, basedOn: 'Build login page' },
      ]);
    });

    it('keeps at most 5 suggestions', () => {
      const result = validateTaskSuggestions({ suggestions: [S1, S2, S3, S4, S5, S6] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title, S4.title, S5.title]);
    });

    it('rejects the response when fewer than 3 valid suggestions remain', () => {
      expect(() => validateTaskSuggestions({ suggestions: [S1, S2] }, CONTEXT)).toThrow(LlmValidationError);
      expect(() => validateTaskSuggestions({ suggestions: [S1, S2] }, CONTEXT)).toThrow(/only 2 valid/);
    });

    it.each([
      ['a non-object', 'suggestions'],
      ['null', null],
      ['an array', [S1, S2, S3]],
      ['a missing suggestions array', { items: [S1, S2, S3] }],
      ['suggestions that are not an array', { suggestions: 'S1, S2, S3' }],
    ])('rejects %s', (_label, value) => {
      expect(() => validateTaskSuggestions(value, CONTEXT)).toThrow(LlmValidationError);
    });

    it('drops suggestions that are not based on a backlog task', () => {
      const unrelated = suggestion('Add payment gateway', 'Payment integration');
      const fromSprint = suggestion('Add API examples', 'Write API documentation');

      const result = validateTaskSuggestions({ suggestions: [unrelated, fromSprint, S1, S2, S3] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title]);
    });

    it('matches a loosely written basedOn to the real backlog title', () => {
      const result = validateTaskSuggestions(
        { suggestions: [suggestion('Add logout button', 'login page'), S1, S2] },
        CONTEXT,
      );

      expect(result.suggestions[0].basedOn).toBe('Build login page');
    });

    it('drops suggestions with an invalid priority and normalises letter case', () => {
      const urgent = suggestion('Add captcha to login', 'Build login page', 'urgent');
      const upper = suggestion('Add remember me option', 'Build login page', 'HIGH');

      const result = validateTaskSuggestions({ suggestions: [urgent, S1, S2, upper] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, upper.title]);
      expect(result.suggestions[2].priority).toBe('high');
    });

    it('drops malformed items (non-objects and missing or blank fields)', () => {
      const malformed = [
        null,
        'Add logout button',
        ['Add logout button'],
        { ...S4, title: '   ' },
        { ...S4, description: undefined },
        { ...S4, reasoning: 42 },
        { ...S4, basedOn: '' },
      ];

      const result = validateTaskSuggestions({ suggestions: [...malformed, S1, S2, S3] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title]);
    });

    it('filters near-duplicates of existing project tasks, including tasks already in a sprint', () => {
      const duplicates = [
        suggestion('Build the login page', 'Build login page'),
        suggestion('Login page', 'Build login page'),
        suggestion('Write API documentation', 'Build login page'),
        // 3 of 5 distinct words shared with "Create user registration form" (similarity 0.6).
        suggestion('Create user registration screen', 'Create user registration form'),
      ];

      const result = validateTaskSuggestions({ suggestions: [...duplicates, S1, S2, S3] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title]);
    });

    it('filters a suggestion that repeats an earlier suggestion', () => {
      const repeat = suggestion('Add password-reset flow', 'Build login page');

      const result = validateTaskSuggestions({ suggestions: [S1, repeat, S2, S3] }, CONTEXT);

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title]);
    });

    it('collapses whitespace in the returned text', () => {
      const messy = { ...S1, title: '  Add   password\n reset flow ' };

      const result = validateTaskSuggestions({ suggestions: [messy, S2, S3] }, CONTEXT);

      expect(result.suggestions[0].title).toBe('Add password reset flow');
    });
  });

  describe('TaskSuggestionService', () => {
    it('passes on 404 for an unknown project without reading tasks or calling the AI', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, projectsService, tasksService } = setup(llm);
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project not found'));

      await expect(service.suggest({ projectId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
      expect(tasksService.findBacklog).not.toHaveBeenCalled();
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty backlog without calling the AI', async () => {
      const { llm, completeJson } = fakeLlm({});
      const { service, tasksService } = setup(llm);
      tasksService.findBacklog.mockResolvedValue([]);

      const error = await service.suggest({ projectId: 'project-1' }).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/backlog is empty/);
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('sends only backlog tasks to the AI', async () => {
      const { llm, completeJson } = fakeLlm({ suggestions: [S1, S2, S3] });
      const { service } = setup(llm);

      await service.suggest({ projectId: 'project-1' });

      const options = completeJson.mock.calls[0][0];
      expect(options).toMatchObject({ task: 'task-suggestions', temperature: 0.2, maxTokens: 1500 });
      expect(options.user).toContain('Current backlog — 2 task(s) not yet in a sprint');
      expect(options.user).toContain('Title: Build login page');
      expect(options.user).toContain('Status: todo | Priority: high | Story points: 5');
      expect(options.user).toContain('Description: (none)');
      expect(options.user).not.toContain(SPRINT_TASK.title);
    });

    it('filters suggestions that duplicate tasks already in a sprint', async () => {
      const duplicate = suggestion('Write API documentation', 'Build login page');
      const { llm } = fakeLlm({ suggestions: [duplicate, S1, S2, S3] });
      const { service } = setup(llm);

      const result = await service.suggest({ projectId: 'project-1' });

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title]);
    });

    it('works end to end through the real LlmService', async () => {
      mockOpenRouter(openRouterReply(JSON.stringify({ suggestions: [S1, S2, S3, S4] })));
      const { service } = setup(createLlmService());

      const result = await service.suggest({ projectId: 'project-1' });

      expect(titles(result)).toEqual([S1.title, S2.title, S3.title, S4.title]);
    });

    it('returns 503 when no model gives at least 3 valid suggestions', async () => {
      mockOpenRouter(
        openRouterReply(JSON.stringify({ suggestions: [S1, S2] })),
        openRouterReply('{"suggestions": "none"}'),
      );
      const { service } = setup(createLlmService());

      await expect(service.suggest({ projectId: 'project-1' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('returns 503 when the AI provider fails', async () => {
      mockOpenRouter(httpError(500), httpError(502));
      const { service } = setup(createLlmService());

      await expect(service.suggest({ projectId: 'project-1' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});