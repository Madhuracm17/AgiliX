import { BadRequestException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { z } from 'zod';
import { ActivityInterceptor } from '../../collaboration/activity.interceptor';
import type { TrackedRoute } from '../../collaboration/activity-events';
import { CommentsService } from '../../collaboration/comments.service';
import { COMMENT_MAX_LENGTH } from '../../collaboration/schemas/comment.schema';
import { CompleteSprintDto } from '../../sprints/dto/complete-sprint.dto';
import { CreateSprintDto } from '../../sprints/dto/create-sprint.dto';
import { SprintsController } from '../../sprints/sprints.controller';
import { CreateTaskDto } from '../../tasks/dto/create-task.dto';
import { UpdateTaskDto } from '../../tasks/dto/update-task.dto';
import { TaskPriority, TaskStatus, TaskType } from '../../tasks/schemas/task.schema';
import { STORY_POINT_SCALE } from '../../tasks/story-points';
import { TasksController } from '../../tasks/tasks.controller';
import type { McpIdentity } from '../mcp-identity';
import { defineMcpTool, type AnyMcpToolDefinition, type McpToolContext } from '../mcp-tool.types';
import { objectId, slimSprint, slimTask } from './tool-helpers';

/*
 * MCP tools that CHANGE data.
 *
 * Safety design:
 *  1. Every tool calls the SAME HTTP controller method the web app calls
 *     (TasksController, SprintsController). So every rule of the app applies
 *     unchanged: roles, project membership, "only a tester or manager marks Done",
 *     WIP limits, approval requests for developers, sprint rules. Nothing is
 *     re-implemented here, so the MCP route can never be more permissive.
 *  2. Arguments are validated twice: by zod (the MCP input schema) and by the
 *     same class-validator DTOs the HTTP ValidationPipe uses.
 *  3. They act as the MCP_USER_EMAIL account, with that account's role.
 *  4. Nothing is deleted through MCP.
 *  5. Changes are written to the project's activity log, like changes made in the web app.
 *  6. They are only registered when MCP_WRITE_TOOLS_ENABLED is true
 *     (src/mcp/mcp-server.constants.ts), and every call is written to the server log.
 */

const logger = new Logger('AgiliX MCP write');

const enumValues = <T extends Record<string, string>>(e: T) => Object.values(e) as [string, ...string[]];
const STORY_POINTS = z
  .number()
  .refine((n) => (STORY_POINT_SCALE as readonly number[]).includes(n), {
    message: `Story points must be one of ${STORY_POINT_SCALE.join(', ')}`,
  })
  .describe(`Story points: ${STORY_POINT_SCALE.join(', ')}.`);
const DATE = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Use a date like 2026-10-21')
  .describe('Date, YYYY-MM-DD.');

/** Runs the DTO through class-validator exactly like the HTTP ValidationPipe (whitelist + transform). */
export async function toValidDto<T extends object>(cls: new () => T, value: Record<string, unknown>): Promise<T> {
  const defined = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
  const dto = plainToInstance(cls, defined);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(messages.length ? messages : 'Invalid input');
  }
  return dto;
}

/** The acting account, as the controllers expect it ({ userId, role }), plus an audit line. */
async function actor(ctx: McpToolContext, tool: string, args: Record<string, unknown>): Promise<McpIdentity> {
  const user = await ctx.user();
  logger.log(`${tool} by ${user.email} (${user.role}) ${JSON.stringify(args)}`);
  return user;
}

const asAuth = (user: McpIdentity) => ({ userId: user.userId, role: user.role });

/** Runs the controller call and records it in the activity log (the HTTP interceptor does not see MCP calls). */
function tracked<T>(
  ctx: McpToolContext,
  route: TrackedRoute,
  params: Record<string, string>,
  body: object,
  user: McpIdentity,
  call: () => Promise<T>,
): Promise<T> {
  return ctx.get(ActivityInterceptor).track(route, params, { ...body } as Record<string, unknown>, asAuth(user), call);
}

export const createTaskTool = defineMcpTool({
  name: 'agilix_create_task',
  title: 'Create a task',
  description:
    'Creates a task in a project (in the backlog, or on the Kanban board). Same rules as the web app: managers ' +
    'create it straight away and may assign anyone on the team; developers and testers may only assign ' +
    'themselves, and their task becomes an APPROVAL REQUEST for a manager instead (the result says so). ' +
    'Admins cannot create tasks.',
  readOnly: false,
  inputSchema: {
    projectId: objectId('project'),
    title: z.string().trim().min(1).max(200).describe('Short task title.'),
    description: z.string().max(5000).optional(),
    priority: z.enum(enumValues(TaskPriority)).optional(),
    type: z.enum(enumValues(TaskType)).optional(),
    storyPoints: STORY_POINTS.optional(),
    assigneeId: z.string().trim().optional().describe('User id of the person to assign (must be on the team).'),
  },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_create_task', args);
    const dto = await toValidDto(CreateTaskDto, {
      project: args.projectId,
      title: args.title,
      description: args.description,
      priority: args.priority,
      type: args.type,
      storyPoints: args.storyPoints,
      assignee: args.assigneeId,
    });
    const result = (await tracked(ctx, 'POST /tasks', {}, dto, user, () =>
      ctx.get(TasksController).create(dto, asAuth(user)),
    )) as unknown;
    // Developers and testers get an approval request, not a task.
    if (result && typeof result === 'object' && 'title' in result && 'status' in result) {
      return { created: true, task: slimTask(result) };
    }
    return {
      created: false,
      pendingApproval: true,
      message: 'A manager has to approve this task before it is created. The managers were notified.',
      request: result,
    };
  },
});

export const updateTaskTool = defineMcpTool({
  name: 'agilix_update_task',
  title: 'Edit a task',
  description:
    'Changes a task\'s title, description, priority, type, story points or assignee. Same rules as the web app: ' +
    'title, description, priority and assignee are for managers; story points for the assignee or a manager. ' +
    'To move a task between columns use agilix_move_task.',
  readOnly: false,
  inputSchema: {
    taskId: objectId('task'),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    priority: z.enum(enumValues(TaskPriority)).optional(),
    type: z.enum(enumValues(TaskType)).optional(),
    storyPoints: STORY_POINTS.optional(),
    assigneeId: z
      .string()
      .trim()
      .nullable()
      .optional()
      .describe('User id of the new assignee, or null to unassign.'),
  },
  handler: async (args, ctx) => {
    const { taskId, assigneeId, ...rest } = args;
    const fields = { ...rest, ...(assigneeId !== undefined ? { assignee: assigneeId } : {}) };
    if (!Object.values(fields).some((v) => v !== undefined)) {
      throw new BadRequestException('Nothing to change. Give at least one field.');
    }
    const user = await actor(ctx, 'agilix_update_task', args);
    const dto = await toValidDto(UpdateTaskDto, fields);
    return slimTask(
      await tracked(ctx, 'PATCH /tasks/:id', { id: taskId }, dto, user, () =>
        ctx.get(TasksController).update(taskId, dto, asAuth(user)),
      ),
    );
  },
});

export const moveTaskTool = defineMcpTool({
  name: 'agilix_move_task',
  title: 'Move a task to another column',
  description:
    'Moves a task to todo, in_progress, review or done. Same rules as the web app: sprint tasks move one step ' +
    'at a time; only a tester, manager or admin can move Review to Done; sending a task back from Review to ' +
    'In Progress needs a reviewComment for the developer; the WIP limit applies on Kanban boards.',
  readOnly: false,
  inputSchema: {
    taskId: objectId('task'),
    status: z.enum(enumValues(TaskStatus)),
    reviewComment: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Required when sending a task back from Review to In Progress.'),
  },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_move_task', args);
    const dto = await toValidDto(UpdateTaskDto, { status: args.status, reviewComment: args.reviewComment });
    return slimTask(
      await tracked(ctx, 'PATCH /tasks/:id', { id: args.taskId }, dto, user, () =>
        ctx.get(TasksController).update(args.taskId, dto, asAuth(user)),
      ),
    );
  },
});

export const addTaskToSprintTool = defineMcpTool({
  name: 'agilix_add_task_to_sprint',
  title: 'Add a task to a sprint',
  description:
    'Puts a backlog task into a sprint of the same project. Managers can add any task; developers and testers ' +
    'only tasks that are unassigned or assigned to them.',
  readOnly: false,
  inputSchema: { taskId: objectId('task'), sprintId: objectId('sprint') },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_add_task_to_sprint', args);
    const params = { id: args.taskId, sprintId: args.sprintId };
    return slimTask(
      await tracked(ctx, 'PATCH /tasks/:id/sprint/:sprintId', params, {}, user, () =>
        ctx.get(TasksController).assignToSprint(args.taskId, args.sprintId, asAuth(user)),
      ),
    );
  },
});

export const createSprintTool = defineMcpTool({
  name: 'agilix_create_sprint',
  title: 'Create a sprint',
  description: 'Managers only. Creates a planned sprint with a name, optional goal, and start and end dates.',
  readOnly: false,
  inputSchema: {
    projectId: objectId('project'),
    name: z.string().trim().min(1).max(100),
    goal: z.string().trim().max(500).optional(),
    startDate: DATE,
    endDate: DATE,
  },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_create_sprint', args);
    const dto = await toValidDto(CreateSprintDto, {
      project: args.projectId,
      name: args.name,
      goal: args.goal,
      startDate: args.startDate,
      endDate: args.endDate,
    });
    return slimSprint(
      await tracked(ctx, 'POST /sprints', {}, dto, user, () => ctx.get(SprintsController).create(dto, asAuth(user))),
    );
  },
});

export const startSprintTool = defineMcpTool({
  name: 'agilix_start_sprint',
  title: 'Start a sprint',
  description: 'Managers only. Starts a planned sprint (only one sprint can be active per project).',
  readOnly: false,
  inputSchema: { sprintId: objectId('sprint') },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_start_sprint', args);
    return slimSprint(
      await tracked(ctx, 'PATCH /sprints/:id/start', { id: args.sprintId }, {}, user, () =>
        ctx.get(SprintsController).start(args.sprintId, asAuth(user)),
      ),
    );
  },
});

export const completeSprintTool = defineMcpTool({
  name: 'agilix_complete_sprint',
  title: 'Complete a sprint',
  description:
    'Managers only. Completes the active sprint. Unfinished tasks go to the planned sprint given in ' +
    'moveUnfinishedToSprintId, or back to the backlog when it is left out.',
  readOnly: false,
  inputSchema: {
    sprintId: objectId('sprint'),
    moveUnfinishedToSprintId: z.string().trim().optional().describe('Id of a PLANNED sprint in the same project.'),
  },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_complete_sprint', args);
    const dto = await toValidDto(CompleteSprintDto, { moveUnfinishedTo: args.moveUnfinishedToSprintId });
    const result = await tracked(ctx, 'PATCH /sprints/:id/complete', { id: args.sprintId }, dto, user, () =>
      ctx.get(SprintsController).complete(args.sprintId, dto, asAuth(user)),
    );
    return {
      sprint: slimSprint(result.sprint),
      unfinishedTasksMoved: result.movedCount,
      movedTo: result.movedToSprint ? { id: result.movedToSprint._id, name: result.movedToSprint.name } : 'backlog',
    };
  },
});

export const addCommentTool = defineMcpTool({
  name: 'agilix_add_comment',
  title: 'Comment on a task',
  description:
    'Adds a comment to a task as the MCP account. Anyone on the project\'s team can comment (not admins). ' +
    'The task\'s assignee and earlier commenters are notified, and it appears in the activity log.',
  readOnly: false,
  inputSchema: {
    taskId: objectId('task'),
    text: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  },
  handler: async (args, ctx) => {
    const user = await actor(ctx, 'agilix_add_comment', { taskId: args.taskId });
    return ctx.get(CommentsService).create(asAuth(user), args.taskId, args.text);
  },
});

/** All write tools. index.ts registers them only when MCP_WRITE_TOOLS_ENABLED is true. */
export const MCP_WRITE_TOOLS: AnyMcpToolDefinition[] = [
  createTaskTool,
  updateTaskTool,
  moveTaskTool,
  addTaskToSprintTool,
  createSprintTool,
  startSprintTool,
  completeSprintTool,
  addCommentTool,
];
