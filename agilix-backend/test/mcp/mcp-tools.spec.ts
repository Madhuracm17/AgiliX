import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessService } from '../../src/auth/access.service';
import { ActivityInterceptor } from '../../src/collaboration/activity.interceptor';
import { GoogleCalendarService } from '../../src/integrations/google-calendar/google-calendar.service';
import type { McpIdentity } from '../../src/mcp/mcp-identity';
import { MCP_WRITE_TOOLS_ENABLED } from '../../src/mcp/mcp-server.constants';
import type { McpToolContext } from '../../src/mcp/mcp-tool.types';
import { MCP_TOOLS } from '../../src/mcp/tools';
import { calendarLoadTool } from '../../src/mcp/tools/integration.tools';
import {
  addTaskToSprintTool,
  completeSprintTool,
  createTaskTool,
  MCP_WRITE_TOOLS,
  moveTaskTool,
  toValidDto,
  updateTaskTool,
} from '../../src/mcp/tools/write.tools';
import { SprintsController } from '../../src/sprints/sprints.controller';
import { CreateTaskDto } from '../../src/tasks/dto/create-task.dto';
import { UpdateTaskDto } from '../../src/tasks/dto/update-task.dto';
import { TasksController } from '../../src/tasks/tasks.controller';
import { UserRole } from '../../src/users/schemas/user.schema';

const PROJECT = '64b7f0c2a1b2c3d4e5f60701';
const TASK = '64b7f0c2a1b2c3d4e5f60702';
const SPRINT = '64b7f0c2a1b2c3d4e5f60703';
const ME = '64b7f0c2a1b2c3d4e5f60704';

function identity(role: UserRole): McpIdentity {
  return { userId: ME, role, name: 'Lekha', email: 'lekha@example.com' };
}

/**
 * Stands in for the activity recorder: runs the call and remembers what it was asked to log.
 * (A plain function, so the jest config's restoreMocks cannot reset it between tests.)
 */
let tracked: Array<{ route: string; params: unknown; body: unknown; user: unknown }> = [];
const tracker = {
  track: (route: string, params: unknown, body: unknown, user: unknown, call: () => unknown) => {
    tracked.push({ route, params, body, user });
    return call();
  },
};

/** A tool context whose ctx.get() returns the given fakes (plus the activity tracker). */
function context(role: UserRole, providers: Array<[unknown, unknown]>): McpToolContext {
  tracked = [];
  const map = new Map<unknown, unknown>([[ActivityInterceptor, tracker], ...providers]);
  return {
    user: async () => identity(role),
    get: ((token: unknown) => {
      if (!map.has(token)) throw new Error(`no fake for ${String(token)}`);
      return map.get(token);
    }) as McpToolContext['get'],
  };
}

const TASK_DOC = { _id: TASK, title: 'Login page', status: 'todo', priority: 'medium', project: PROJECT };

describe('MCP tool registry', () => {
  it('has unique tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers write tools only when the safety switch is on', () => {
    const writeNames = MCP_WRITE_TOOLS.map((t) => t.name);
    const registered = MCP_TOOLS.filter((t) => writeNames.includes(t.name));
    expect(registered.length).toBe(MCP_WRITE_TOOLS_ENABLED ? MCP_WRITE_TOOLS.length : 0);
    if (!MCP_WRITE_TOOLS_ENABLED) expect(MCP_TOOLS.every((t) => t.readOnly)).toBe(true);
  });

  it('marks every write tool as changing data, and offers no delete tool', () => {
    expect(MCP_WRITE_TOOLS.every((t) => t.readOnly === false)).toBe(true);
    expect(MCP_WRITE_TOOLS.some((t) => /delete|remove/.test(t.name))).toBe(false);
  });
});

describe('toValidDto (same rules as the HTTP ValidationPipe)', () => {
  it('accepts valid input and drops undefined fields', async () => {
    const dto = await toValidDto(CreateTaskDto, { project: PROJECT, title: 'Login', storyPoints: 5, assignee: undefined });
    expect(dto).toBeInstanceOf(CreateTaskDto);
    expect(dto).toEqual({ project: PROJECT, title: 'Login', storyPoints: 5 });
  });

  it('rejects a story point value outside the scale', async () => {
    await expect(toValidDto(CreateTaskDto, { project: PROJECT, title: 'Login', storyPoints: 4 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects fields the DTO does not know', async () => {
    await expect(toValidDto(UpdateTaskDto, { status: 'done', completedAt: 'now' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a bad id', async () => {
    await expect(toValidDto(CreateTaskDto, { project: 'nope', title: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('write tools go through the web app controllers', () => {
  it('create_task: a manager creates the task, acting as the MCP account', async () => {
    const create = jest.fn().mockResolvedValue(TASK_DOC);
    const ctx = context(UserRole.MANAGER, [[TasksController, { create }]]);

    const result = (await createTaskTool.handler(
      { projectId: PROJECT, title: 'Login page', priority: 'high', assigneeId: ME },
      ctx,
    )) as { created: boolean; task: { id: string } };

    expect(create).toHaveBeenCalledTimes(1);
    const [dto, user] = create.mock.calls[0];
    expect(dto).toBeInstanceOf(CreateTaskDto);
    expect(dto).toEqual({ project: PROJECT, title: 'Login page', priority: 'high', assignee: ME });
    expect(user).toEqual({ userId: ME, role: UserRole.MANAGER });
    expect(result.created).toBe(true);
    expect(result.task.id).toBe(TASK);
    // ...and it is written to the activity log like a change made in the web app.
    expect(tracked).toEqual([
      { route: 'POST /tasks', params: {}, body: expect.anything(), user: { userId: ME, role: UserRole.MANAGER } },
    ]);
  });

  it('create_task: for a developer the controller returns an approval request, and the tool says so', async () => {
    const create = jest.fn().mockResolvedValue({ _id: 'req1', type: 'create_task', taskTitle: 'Login page' });
    const ctx = context(UserRole.DEVELOPER, [[TasksController, { create }]]);
    const result = (await createTaskTool.handler({ projectId: PROJECT, title: 'Login page' }, ctx)) as {
      created: boolean;
      pendingApproval: boolean;
    };
    expect(result.created).toBe(false);
    expect(result.pendingApproval).toBe(true);
  });

  it('move_task: passes the status and review comment, and the controller decides', async () => {
    const update = jest.fn().mockResolvedValue({ ...TASK_DOC, status: 'in_progress' });
    const ctx = context(UserRole.TESTER, [[TasksController, { update }]]);
    await moveTaskTool.handler({ taskId: TASK, status: 'in_progress', reviewComment: 'Fix the error message' }, ctx);
    expect(update).toHaveBeenCalledWith(
      TASK,
      expect.objectContaining({ status: 'in_progress', reviewComment: 'Fix the error message' }),
      { userId: ME, role: UserRole.TESTER },
    );
  });

  it('move_task: a refusal from the web app rules reaches the MCP client unchanged', async () => {
    const update = jest.fn().mockRejectedValue(new ForbiddenException('Only a tester or manager can mark a task Done.'));
    const ctx = context(UserRole.DEVELOPER, [[TasksController, { update }]]);
    await expect(moveTaskTool.handler({ taskId: TASK, status: 'done' }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update_task: refuses an empty change and maps assigneeId to assignee', async () => {
    const update = jest.fn().mockResolvedValue(TASK_DOC);
    const ctx = context(UserRole.MANAGER, [[TasksController, { update }]]);
    await expect(updateTaskTool.handler({ taskId: TASK }, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await updateTaskTool.handler({ taskId: TASK, assigneeId: null }, ctx);
    expect(update.mock.calls[0][1]).toEqual({ assignee: null });
  });

  it('add_task_to_sprint and complete_sprint call the matching controller methods', async () => {
    const assignToSprint = jest.fn().mockResolvedValue(TASK_DOC);
    const complete = jest.fn().mockResolvedValue({
      sprint: { _id: SPRINT, name: 'Sprint 3', status: 'completed' },
      movedCount: 2,
      movedToSprint: null,
    });
    const ctx = context(UserRole.MANAGER, [
      [TasksController, { assignToSprint }],
      [SprintsController, { complete }],
    ]);
    await addTaskToSprintTool.handler({ taskId: TASK, sprintId: SPRINT }, ctx);
    expect(assignToSprint).toHaveBeenCalledWith(TASK, SPRINT, { userId: ME, role: UserRole.MANAGER });
    expect(tracked[0]).toEqual({
      route: 'PATCH /tasks/:id/sprint/:sprintId',
      params: { id: TASK, sprintId: SPRINT },
      body: {},
      user: { userId: ME, role: UserRole.MANAGER },
    });

    const result = (await completeSprintTool.handler({ sprintId: SPRINT }, ctx)) as {
      unfinishedTasksMoved: number;
      movedTo: unknown;
    };
    expect(result.unfinishedTasksMoved).toBe(2);
    expect(result.movedTo).toBe('backlog');
  });
});

describe('agilix_get_meeting_load', () => {
  it('is for managers and admins only', async () => {
    const projectReport = jest.fn();
    const ctx = context(UserRole.DEVELOPER, [
      [AccessService, { assertProject: jest.fn() }],
      [GoogleCalendarService, { projectReport }],
    ]);
    await expect(calendarLoadTool.handler({ projectId: PROJECT }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectReport).not.toHaveBeenCalled();
  });

  it('checks project access before reading calendars', async () => {
    const assertProject = jest.fn().mockRejectedValue(new ForbiddenException('not on the team'));
    const projectReport = jest.fn();
    const ctx = context(UserRole.MANAGER, [
      [AccessService, { assertProject }],
      [GoogleCalendarService, { projectReport }],
    ]);
    await expect(calendarLoadTool.handler({ projectId: PROJECT }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectReport).not.toHaveBeenCalled();
  });

  it('returns the team report for a manager on the project', async () => {
    const projectReport = jest.fn().mockResolvedValue({ projectId: PROJECT, members: [] });
    const ctx = context(UserRole.MANAGER, [
      [AccessService, { assertProject: jest.fn().mockResolvedValue(undefined) }],
      [GoogleCalendarService, { projectReport }],
    ]);
    await calendarLoadTool.handler({ projectId: PROJECT, days: 7 }, ctx);
    expect(projectReport).toHaveBeenCalledWith(PROJECT, 7);
  });
});
