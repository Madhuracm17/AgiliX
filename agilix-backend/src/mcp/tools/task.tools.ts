import { z } from 'zod';
import { TasksService } from '../../tasks/tasks.service';
import { TaskStatus } from '../../tasks/schemas/task.schema';
import { TimeEntriesService } from '../../time-entries/time-entries.service';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId, person, slimTask } from './tool-helpers';

const STATUSES = Object.values(TaskStatus) as [string, ...string[]];

export const listTasksTool = defineMcpTool({
  name: 'agilix_list_tasks',
  title: 'List tasks',
  description:
    'Lists the tasks of a project, optionally filtered by status (todo, in_progress, review, done), ' +
    'by assignee id, or to only backlog tasks (not in any sprint). Returns title, status, priority, ' +
    'story points, assignee and sprint id for each task.',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    status: z.enum(STATUSES).optional().describe('Only tasks in this status.'),
    assigneeId: z.string().trim().optional().describe('Only tasks assigned to this user id.'),
    backlogOnly: z.boolean().optional().describe('true = only tasks not in any sprint.'),
  },
  handler: async ({ projectId, status, assigneeId, backlogOnly }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    const tasks = ctx.get(TasksService);
    const docs = backlogOnly ? await tasks.findBacklog(projectId) : await tasks.findAllForProject(projectId);
    return docs
      .map(slimTask)
      .filter((t) => !status || t.status === status)
      .filter((t) => !assigneeId || t.assignee?.id === assigneeId);
  },
});

export const getTaskTimeTool = defineMcpTool({
  name: 'agilix_get_task_time',
  title: 'Get time tracked on a task',
  description:
    'Returns the total time tracked on one task (seconds and hours) and its finished time entries ' +
    '(who, start, end, duration), newest first. A running timer is not counted until it is stopped.',
  readOnly: true,
  inputSchema: { taskId: objectId('task') },
  handler: async ({ taskId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertTask(user, taskId);
    const time = ctx.get(TimeEntriesService);
    const [{ totalSeconds }, entries] = await Promise.all([
      time.getTaskTotal(taskId),
      time.findForTask(taskId),
    ]);
    return {
      taskId,
      totalSeconds,
      totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
      entries: entries.map((e) => ({
        user: person(e.user),
        startTime: e.startTime,
        endTime: e.endTime ?? null,
        durationSeconds: e.durationSeconds ?? 0,
        running: e.endTime == null,
      })),
    };
  },
});
