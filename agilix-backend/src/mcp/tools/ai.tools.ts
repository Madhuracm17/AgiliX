import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../../ai/ai.service';
import { EstimateStoryPointsDto } from '../../ai/dto/estimate-story-points.dto';
import { RecommendPriorityDto } from '../../ai/dto/recommend-priority.dto';
import { SuggestTasksDto } from '../../ai/dto/suggest-tasks.dto';
import { KanbanInsightsService } from '../../ai/kanban-insights.service';
import { PriorityRecommendationService } from '../../ai/priority-recommendation.service';
import { StoryPointEstimationService } from '../../ai/story-point-estimation.service';
import { TaskSuggestionService } from '../../ai/task-suggestion.service';
import type { AccessService } from '../../auth/access.service';
import { TaskPriority } from '../../tasks/schemas/task.schema';
import type { McpIdentity } from '../mcp-identity';
import { defineMcpTool } from '../mcp-tool.types';
import { validateDto } from '../mcp-validation';
import { actingUser, objectId } from './tool-helpers';

/*
 * AI tools. They wrap the existing AI services, which only SUGGEST: nothing is
 * created or changed, so every tool is read-only.
 *
 * Access: the acting user must be on the project (AccessService), the same rule
 * as reading the project's tasks. Any task or sprint id passed in must belong
 * to that same project.
 *
 * AI calls go to OpenRouter and can take up to ~30 s per model. When every
 * model fails, the service throws 503 → "Error 503: ..." for the client.
 */

const AI_NOTE =
  ' Uses an LLM, so it can take up to about 30 seconds. It only suggests; nothing is saved.';

const PRIORITIES = Object.values(TaskPriority) as [string, ...string[]];

/** A task id passed to an AI tool must be visible to the user AND belong to the given project. */
async function assertTaskInProject(
  access: AccessService,
  user: McpIdentity,
  taskId: string,
  projectId: string,
): Promise<void> {
  const task = await access.assertTask(user, taskId);
  if (task.projectId !== projectId) {
    throw new BadRequestException('That task belongs to a different project.');
  }
}

export const predictSprintRiskTool = defineMcpTool({
  name: 'agilix_predict_sprint_risk',
  title: 'AI: predict sprint risk',
  description:
    'Predicts whether a planned or active sprint will finish on time: risk level (green, yellow or ' +
    'red), a short reasoning, and a forecast of the percentage of story points that will be completed. ' +
    'Completed sprints are rejected.' + AI_NOTE,
  readOnly: true,
  inputSchema: { sprintId: objectId('sprint') },
  handler: async ({ sprintId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertSprint(user, sprintId);
    return ctx.get(AiService).predictSprintRisk(sprintId);
  },
});

export const estimateStoryPointsTool = defineMcpTool({
  name: 'agilix_estimate_story_points',
  title: 'AI: estimate story points',
  description:
    'Suggests a story-point estimate (0, 1, 2, 3, 5, 8 or 13) for a task, with reasoning, using the project ' +
    'and its other estimated tasks as reference. Works for a new task idea (title + description) or an ' +
    'existing task (also pass taskId so it is not compared with itself).' + AI_NOTE,
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    title: z.string().trim().min(1).max(200).describe('Task title.'),
    description: z.string().max(4000).optional().describe('Task description.'),
    priority: z.enum(PRIORITIES).optional().describe('Task priority, if known.'),
    taskId: z.string().trim().optional().describe('Id of an existing task being re-estimated.'),
  },
  handler: async ({ projectId, title, description, priority, taskId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    if (taskId) await assertTaskInProject(access, user, taskId, projectId);
    // Same validation as the HTTP route (class-validator rules on the DTO).
    const dto = await validateDto(EstimateStoryPointsDto, {
      project: projectId,
      title,
      description,
      priority,
      taskId,
    });
    return ctx.get(StoryPointEstimationService).estimate(dto);
  },
});

export const recommendPriorityTool = defineMcpTool({
  name: 'agilix_recommend_priority',
  title: 'AI: recommend priority',
  description:
    'Recommends a priority (low, medium or high) for a task, with reasoning, compared with ' +
    'the project\'s other open tasks. The current priority is deliberately not used, so it cannot bias ' +
    'the answer. Pass taskId for an existing task.' + AI_NOTE,
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    title: z.string().trim().min(1).max(200).describe('Task title.'),
    description: z.string().max(4000).optional().describe('Task description.'),
    taskId: z.string().trim().optional().describe('Id of an existing task.'),
  },
  handler: async ({ projectId, title, description, taskId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    if (taskId) await assertTaskInProject(access, user, taskId, projectId);
    const dto = await validateDto(RecommendPriorityDto, {
      project: projectId,
      title,
      description,
      taskId,
    });
    return ctx.get(PriorityRecommendationService).recommend(dto);
  },
});

export const suggestTasksTool = defineMcpTool({
  name: 'agilix_suggest_tasks',
  title: 'AI: suggest new tasks',
  description:
    'Suggests new tasks that are missing from a project\'s backlog, based on the project description ' +
    'and the existing backlog. Each suggestion has a title, description, priority and reasoning.' + AI_NOTE,
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    const dto = await validateDto(SuggestTasksDto, { projectId });
    return ctx.get(TaskSuggestionService).suggest(dto);
  },
});

export const kanbanInsightsTool = defineMcpTool({
  name: 'agilix_get_kanban_insights',
  title: 'AI: Kanban board insights',
  description:
    'Kanban projects only. Board metrics calculated from the data (tasks per stage, work in progress) ' +
    'plus an AI analysis: health (healthy, attention or critical), a summary, bottlenecks and ' +
    'recommendations.' + AI_NOTE,
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    reviewEnabled: z
      .boolean()
      .optional()
      .describe('Whether the board uses a Review column. Leave out to use the project setting.'),
  },
  handler: async ({ projectId, reviewEnabled }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    return ctx.get(KanbanInsightsService).getInsights(projectId, reviewEnabled);
  },
});
