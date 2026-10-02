import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  KanbanInsightsService,
  KanbanTaskRecord,
  KanbanWorkflow,
  buildKanbanPrompt,
  calculateKanbanMetrics,
  describeLimitations,
  resolveKanbanWorkflow,
  validateKanbanAnalysis,
} from '../../src/ai/kanban-insights.service';
import { LlmService, LlmValidationError } from '../../src/ai/llm.service';
import type { ProjectsService } from '../../src/projects/projects.service';
import type { TasksService } from '../../src/tasks/tasks.service';
import {
  captureError,
  captureLogs,
  createLlmService,
  fakeLlm,
  httpError,
  mockOpenRouter,
  networkError,
  openRouterReply,
} from './test-helpers';

const PROJECT_ID = '64b7f0c2a1b2c3d4e5f60718';
const DAY_MS = 86400000;
const NOW = new Date('2026-10-08T12:00:00.000Z');

const ASHA = { _id: 'user-asha', name: 'Asha' };
const BEN = { _id: 'user-ben', name: 'Ben' };

/** A Kanban board using Todo → In Progress → Review → Done, relative to `now`. */
function boardTasks(now: Date): KanbanTaskRecord[] {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return [
    { title: 'Design settings page', status: 'todo', priority: 'high', storyPoints: 3, assignee: null, updatedAt: daysAgo(1) },
    { title: 'Export to CSV', status: 'todo', priority: 'high', storyPoints: 0, assignee: ASHA, updatedAt: daysAgo(1) },
    { title: 'Update footer', status: 'todo', priority: 'low', assignee: BEN, updatedAt: daysAgo(2) },
    { title: 'Payment API', status: 'in_progress', priority: 'medium', storyPoints: 5, assignee: ASHA, updatedAt: daysAgo(10) },
    { title: 'Login page', status: 'in_progress', priority: 'high', storyPoints: 8, assignee: ASHA, updatedAt: daysAgo(1) },
    { title: 'Email alerts', status: 'in_progress', priority: 'medium', storyPoints: 3, assignee: BEN, updatedAt: daysAgo(12) },
    { title: 'Search bar', status: 'review', priority: 'medium', storyPoints: 2, assignee: BEN, updatedAt: daysAgo(2) },
    { title: 'Audit log', status: 'review', priority: 'low', storyPoints: 0, assignee: null, updatedAt: daysAgo(9) },
    { title: 'Fix crash on save', status: 'review', priority: 'high', assignee: ASHA, updatedAt: daysAgo(3) },
    { title: 'Sign-up form', status: 'done', priority: 'medium', storyPoints: 5, assignee: ASHA, updatedAt: daysAgo(4) },
    { title: 'Logo', status: 'done', priority: 'low', storyPoints: 1, assignee: BEN, updatedAt: daysAgo(6) },
  ];
}

const WITH_REVIEW: KanbanWorkflow = {
  reviewEnabled: true,
  stages: ['todo', 'in_progress', 'review', 'done'] as KanbanWorkflow['stages'],
  source: 'request',
};
const WITHOUT_REVIEW: KanbanWorkflow = {
  reviewEnabled: false,
  stages: ['todo', 'in_progress', 'done'] as KanbanWorkflow['stages'],
  source: 'request',
};

const VALID_ANALYSIS = {
  health: 'attention',
  summary: '6 of 11 tasks are in progress or review while only 2 are done.',
  bottlenecks: [{ stage: 'in_progress', reason: '2 in-progress tasks have not been updated for 10+ days.' }],
  recommendations: ['Finish the 3 Review tasks before starting new work.'],
};

function setup(
  llm: LlmService,
  options: { project?: Record<string, unknown>; tasks?: KanbanTaskRecord[] } = {},
) {
  const project = options.project ?? { _id: PROJECT_ID, name: 'Mobile App', methodology: 'kanban' };
  const projectsService = { findOne: jest.fn().mockResolvedValue(project) };
  const tasksService = {
    findAllForProject: jest.fn().mockResolvedValue(options.tasks ?? boardTasks(new Date())),
  };
  const service = new KanbanInsightsService(
    projectsService as unknown as ProjectsService,
    tasksService as unknown as TasksService,
    llm,
  );
  return { service, projectsService, tasksService };
}

describe('AI Kanban Insights', () => {
  beforeEach(() => {
    captureLogs();
  });

  describe('workflow (Review stage) resolution', () => {
    const noReviewTasks = boardTasks(NOW).filter((t) => t.status !== 'review');

    it('uses the Review setting passed by the caller first', () => {
      const workflow = resolveKanbanWorkflow({ reviewEnabled: true }, noReviewTasks, false);

      expect(workflow).toEqual({ reviewEnabled: false, stages: ['todo', 'in_progress', 'done'], source: 'request' });
    });

    it('uses Project.reviewEnabled when the project stores it', () => {
      const workflow = resolveKanbanWorkflow({ reviewEnabled: true }, noReviewTasks);

      expect(workflow).toEqual({
        reviewEnabled: true,
        stages: ['todo', 'in_progress', 'review', 'done'],
        source: 'project',
      });
    });

    it('infers Review from the current task statuses when no setting exists', () => {
      expect(resolveKanbanWorkflow({}, boardTasks(NOW))).toMatchObject({ reviewEnabled: true, source: 'inferred' });
      expect(resolveKanbanWorkflow({}, noReviewTasks)).toMatchObject({ reviewEnabled: false, source: 'inferred' });
    });
  });

  describe('metrics (calculated, never from the AI)', () => {
    it('calculates the task distribution for a board with Review', () => {
      const metrics = calculateKanbanMetrics(boardTasks(NOW), WITH_REVIEW, NOW);

      expect(metrics).toMatchObject({
        totalTasks: 11,
        todo: 3,
        inProgress: 3,
        review: 3,
        done: 2,
        outsideWorkflow: 0,
        open: 9,
        workInProgress: 6,
        donePercent: 18,
      });
      expect(metrics.priority).toEqual({ open: { high: 4, medium: 3, low: 2 }, highNotStarted: 2 });
      expect(metrics.storyPoints).toEqual({ total: 27, done: 6, open: 21, unestimatedOpenTasks: 4 });
    });

    it('calculates assignment and per-person work in progress', () => {
      const { assignment } = calculateKanbanMetrics(boardTasks(NOW), WITH_REVIEW, NOW);

      expect(assignment.assigned).toBe(9);
      expect(assignment.unassigned).toBe(2);
      expect(assignment.unassignedOpen).toBe(2);
      expect(assignment.busiest).toEqual([
        { name: 'Asha', wip: 3, open: 4 },
        { name: 'Ben', wip: 2, open: 3 },
      ]);
    });

    it('lists work in progress not updated for 7+ days, longest first', () => {
      const { staleWork } = calculateKanbanMetrics(boardTasks(NOW), WITH_REVIEW, NOW);

      expect(staleWork.thresholdDays).toBe(7);
      expect(staleWork.count).toBe(3);
      expect(staleWork.tasks).toEqual([
        { title: 'Email alerts', status: 'in_progress', daysSinceUpdate: 12 },
        { title: 'Payment API', status: 'in_progress', daysSinceUpdate: 10 },
        { title: 'Audit log', status: 'review', daysSinceUpdate: 9 },
      ]);
    });

    it('without Review: review is null and Review tasks are counted outside the workflow', () => {
      const metrics = calculateKanbanMetrics(boardTasks(NOW), WITHOUT_REVIEW, NOW);

      expect(metrics.review).toBeNull();
      expect(metrics.outsideWorkflow).toBe(3);
      expect(metrics.workInProgress).toBe(3);
      expect(metrics.staleWork.count).toBe(2);
      expect(metrics.assignment.busiest[0]).toEqual({ name: 'Asha', wip: 2, open: 4 });
    });

    it('reports story points as null when nothing is estimated, and ignores tasks without dates', () => {
      const tasks = [
        { title: 'A', status: 'in_progress', priority: 'high' },
        { title: 'B', status: 'todo', priority: 'urgent', storyPoints: 0, updatedAt: 'not a date' },
      ];

      const metrics = calculateKanbanMetrics(tasks, WITHOUT_REVIEW, NOW);

      expect(metrics.storyPoints).toBeNull();
      expect(metrics.staleWork.count).toBe(0);
      expect(metrics.priority.open).toEqual({ high: 1, medium: 1, low: 0 }); // unknown priority → schema default
    });

    it('states the data limitations, including an inferred Review setting', () => {
      const workflow = { ...WITHOUT_REVIEW, source: 'inferred' as const };
      const limitations = describeLimitations(workflow, calculateKanbanMetrics(boardTasks(NOW), workflow, NOW));

      expect(limitations[0]).toMatch(/Cycle time, lead time and throughput cannot be calculated/);
      expect(limitations.join(' ')).toContain('Review was treated as disabled');
      expect(limitations.join(' ')).toContain('3 task(s) have a status that is not part of this workflow');
    });
  });

  describe('prompt', () => {
    it('gives the AI the Review stage, its workload and stale Review work when Review is enabled', () => {
      const metrics = calculateKanbanMetrics(boardTasks(NOW), WITH_REVIEW, NOW);
      const prompt = buildKanbanPrompt('Mobile App', WITH_REVIEW, metrics, describeLimitations(WITH_REVIEW, metrics));

      expect(prompt).toContain('Workflow: To Do (todo) → In Progress (in_progress) → Review (review) → Done (done)');
      expect(prompt).toContain('- Review: 3');
      expect(prompt).toContain('- Work in progress (In Progress + Review): 6');
      expect(prompt).toContain('- "Audit log" (Review): last updated 9 days ago');
      expect(prompt).toContain('- Asha: 3 in progress, 4 not done');
      expect(prompt).toContain('- High-priority tasks still in To Do: 2');
    });

    it('does not present a Review stage when Review is disabled', () => {
      const metrics = calculateKanbanMetrics(boardTasks(NOW), WITHOUT_REVIEW, NOW);
      const prompt = buildKanbanPrompt('Mobile App', WITHOUT_REVIEW, metrics, []);

      expect(prompt).toContain('Workflow: To Do (todo) → In Progress (in_progress) → Done (done)');
      expect(prompt).toContain('Review stage: disabled (this board has no Review stage)');
      expect(prompt).not.toContain('- Review:');
      expect(prompt).not.toContain('Review (review)');
      expect(prompt).toContain('- Not in any stage of this workflow: 3');
    });
  });

  describe('validateKanbanAnalysis', () => {
    it('accepts a valid analysis and drops extra fields', () => {
      expect(validateKanbanAnalysis({ ...VALID_ANALYSIS, health: ' Attention ', extra: true }, WITH_REVIEW)).toEqual(
        VALID_ANALYSIS,
      );
    });

    it.each(['good', 'warning', '', null, 3])('rejects health %p', (health) => {
      expect(() => validateKanbanAnalysis({ ...VALID_ANALYSIS, health }, WITH_REVIEW)).toThrow(LlmValidationError);
    });

    it.each([null, 'text', [VALID_ANALYSIS]])('rejects a non-object response %p', (value) => {
      expect(() => validateKanbanAnalysis(value, WITH_REVIEW)).toThrow(LlmValidationError);
    });

    it('rejects an empty summary', () => {
      expect(() => validateKanbanAnalysis({ ...VALID_ANALYSIS, summary: '  ' }, WITH_REVIEW)).toThrow(
        'summary must be a non-empty string',
      );
    });

    it('requires bottlenecks to be an array, but allows it to be empty', () => {
      expect(() => validateKanbanAnalysis({ ...VALID_ANALYSIS, bottlenecks: 'none' }, WITH_REVIEW)).toThrow(
        'bottlenecks must be an array',
      );
      expect(validateKanbanAnalysis({ ...VALID_ANALYSIS, bottlenecks: [] }, WITH_REVIEW).bottlenecks).toEqual([]);
    });

    it('keeps a Review bottleneck when Review is enabled', () => {
      const result = validateKanbanAnalysis(
        { ...VALID_ANALYSIS, bottlenecks: [{ stage: 'Review', reason: '3 tasks wait for review.' }] },
        WITH_REVIEW,
      );

      expect(result.bottlenecks).toEqual([{ stage: 'review', reason: '3 tasks wait for review.' }]);
    });

    it('drops Review bottlenecks when Review is disabled, and invalid or incomplete bottlenecks', () => {
      const result = validateKanbanAnalysis(
        {
          ...VALID_ANALYSIS,
          bottlenecks: [
            { stage: 'review', reason: 'Review pile-up.' },
            { stage: 'done', reason: 'Done is not a bottleneck.' },
            { stage: 'testing', reason: 'Not a stage.' },
            { stage: 'todo', reason: '   ' },
            'in_progress',
            null,
            { stage: 'in_progress', reason: 'Too much started work.' },
          ],
        },
        WITHOUT_REVIEW,
      );

      expect(result.bottlenecks).toEqual([{ stage: 'in_progress', reason: 'Too much started work.' }]);
    });

    it('keeps at most 4 bottlenecks', () => {
      const many = Array.from({ length: 6 }, (_, i) => ({ stage: 'todo', reason: `Reason ${i}` }));

      expect(validateKanbanAnalysis({ ...VALID_ANALYSIS, bottlenecks: many }, WITH_REVIEW).bottlenecks).toHaveLength(4);
    });

    it('cleans recommendations: trims, drops non-strings and duplicates, keeps at most 5', () => {
      const result = validateKanbanAnalysis(
        {
          ...VALID_ANALYSIS,
          recommendations: ['  Assign the 2 unassigned tasks. ', 42, '', null, 'assign the 2 unassigned tasks.', 'B', 'C', 'D', 'E', 'F'],
        },
        WITH_REVIEW,
      );

      expect(result.recommendations).toEqual(['Assign the 2 unassigned tasks.', 'B', 'C', 'D', 'E']);
    });

    it.each([
      ['not an array', 'Finish work.'],
      ['an empty array', []],
      ['only empty or non-string items', ['', '   ', 7, null]],
    ])('rejects recommendations that are %s', (_label, recommendations) => {
      expect(() => validateKanbanAnalysis({ ...VALID_ANALYSIS, recommendations }, WITH_REVIEW)).toThrow(
        LlmValidationError,
      );
    });
  });

  describe('KanbanInsightsService.getInsights', () => {
    it('returns calculated metrics and the AI analysis for a board with Review', async () => {
      const { llm, completeJson } = fakeLlm(VALID_ANALYSIS);
      const { service, tasksService } = setup(llm, {
        project: { _id: PROJECT_ID, name: 'Mobile App', methodology: 'kanban', reviewEnabled: true },
      });

      const result = await service.getInsights(PROJECT_ID);

      expect(tasksService.findAllForProject).toHaveBeenCalledWith(PROJECT_ID);
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.workflow).toEqual({
        reviewEnabled: true,
        stages: ['todo', 'in_progress', 'review', 'done'],
        source: 'project',
      });
      expect(result.metrics).toMatchObject({ totalTasks: 11, todo: 3, inProgress: 3, review: 3, done: 2 });
      expect(result.analysis).toEqual(VALID_ANALYSIS);
      expect(result.limitations[0]).toMatch(/cannot be calculated/);
      expect(new Date(result.generatedAt).toString()).not.toBe('Invalid Date');

      const options = completeJson.mock.calls[0][0];
      expect(options).toMatchObject({ task: 'kanban-insights', temperature: 0.2, maxTokens: 1200 });
      expect(options.user).toContain('- Review: 3');
    });

    it('returns a Review-free result for a board without Review', async () => {
      const { llm, completeJson } = fakeLlm({
        ...VALID_ANALYSIS,
        bottlenecks: [
          { stage: 'review', reason: 'Should be dropped.' },
          { stage: 'in_progress', reason: '3 tasks in progress, 2 done.' },
        ],
      });
      const tasks = boardTasks(new Date()).filter((t) => t.status !== 'review');
      const { service } = setup(llm, { tasks });

      const result = await service.getInsights(PROJECT_ID);

      expect(result.workflow).toMatchObject({ reviewEnabled: false, stages: ['todo', 'in_progress', 'done'], source: 'inferred' });
      expect(result.metrics.review).toBeNull();
      expect(result.analysis.bottlenecks).toEqual([{ stage: 'in_progress', reason: '3 tasks in progress, 2 done.' }]);
      expect(completeJson.mock.calls[0][0].user).toContain('Review stage: disabled');
    });

    it('lets the caller turn Review off even when tasks are in Review', async () => {
      const { llm } = fakeLlm(VALID_ANALYSIS);
      const { service } = setup(llm);

      const result = await service.getInsights(PROJECT_ID, false);

      expect(result.workflow.source).toBe('request');
      expect(result.metrics.review).toBeNull();
      expect(result.metrics.outsideWorkflow).toBe(3);
    });

    it('returns 400 for an empty board without calling the AI', async () => {
      const { llm, completeJson } = fakeLlm(VALID_ANALYSIS);
      const { service } = setup(llm, { tasks: [] });

      const error = await captureError(service.getInsights(PROJECT_ID));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/no tasks yet/);
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('passes on 404 for an unknown project', async () => {
      const { llm, completeJson } = fakeLlm(VALID_ANALYSIS);
      const { service, projectsService, tasksService } = setup(llm);
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project not found'));

      await expect(service.getInsights(PROJECT_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(tasksService.findAllForProject).not.toHaveBeenCalled();
      expect(completeJson).not.toHaveBeenCalled();
    });

    it.each(['abc', '', '64b7f0c2a1b2c3d4e5f6071Z', '64b7f0c2a1b2c3d4e5f607181'])(
      'returns 400 for the invalid project id %p without touching the database',
      async (projectId) => {
        const { llm } = fakeLlm(VALID_ANALYSIS);
        const { service, projectsService } = setup(llm);

        await expect(service.getInsights(projectId)).rejects.toBeInstanceOf(BadRequestException);
        expect(projectsService.findOne).not.toHaveBeenCalled();
      },
    );

    it('returns 400 for a Scrum project', async () => {
      const { llm, completeJson } = fakeLlm(VALID_ANALYSIS);
      const { service } = setup(llm, { project: { _id: PROJECT_ID, name: 'Web', methodology: 'scrum' } });

      const error = await captureError(service.getInsights(PROJECT_ID));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/Kanban projects only/);
      expect(completeJson).not.toHaveBeenCalled();
    });

    it('works end to end through the real LlmService', async () => {
      mockOpenRouter(openRouterReply(`Here it is:\n\`\`\`json\n${JSON.stringify(VALID_ANALYSIS)}\n\`\`\``));
      const { service } = setup(createLlmService());

      const result = await service.getInsights(PROJECT_ID);

      expect(result.analysis).toEqual(VALID_ANALYSIS);
    });

    it('tries the next model after an invalid health value', async () => {
      const post = mockOpenRouter(
        openRouterReply(JSON.stringify({ ...VALID_ANALYSIS, health: 'good' })),
        openRouterReply(JSON.stringify(VALID_ANALYSIS)),
      );
      const { service } = setup(createLlmService());

      const result = await service.getInsights(PROJECT_ID);

      expect(result.analysis.health).toBe('attention');
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('returns 503 when every model gives malformed JSON (no invented analysis)', async () => {
      mockOpenRouter(openRouterReply('The board looks fine!'), openRouterReply('{"health": "healthy", '));
      const { service } = setup(createLlmService());

      await expect(service.getInsights(PROJECT_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('returns 503 when the AI provider fails', async () => {
      mockOpenRouter(httpError(500), networkError('ECONNRESET'));
      const { service } = setup(createLlmService());

      await expect(service.getInsights(PROJECT_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});