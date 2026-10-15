import { SprintsService } from '../../sprints/sprints.service';
import { TasksService } from '../../tasks/tasks.service';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId, slimSprint, slimTask } from './tool-helpers';

export const listSprintsTool = defineMcpTool({
  name: 'agilix_list_sprints',
  title: 'List sprints',
  description:
    'Lists the sprints of a Scrum project with name, goal, dates and status (planned, active or ' +
    'completed). Completed sprints also show committed and completed story points.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    const sprints = await ctx.get(SprintsService).findAllForProject(projectId);
    return sprints.map(slimSprint);
  },
});

export const getSprintTool = defineMcpTool({
  name: 'agilix_get_sprint',
  title: 'Get sprint with tasks and stats',
  description:
    'Returns one sprint with its stats (task counts per status, total and completed story points, ' +
    'days remaining) and all of its tasks. Use this to answer "how is the current sprint going?".',
  readOnly: true,
  inputSchema: { sprintId: objectId('sprint') },
  handler: async ({ sprintId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertSprint(user, sprintId);
    const tasks = ctx.get(TasksService);
    const [sprint, stats, sprintTasks] = await Promise.all([
      ctx.get(SprintsService).findOne(sprintId),
      tasks.getSprintStats(sprintId),
      tasks.findForSprint(sprintId),
    ]);
    const slim = slimSprint(sprint);
    const end = new Date(slim.endDate as Date).getTime();
    const daysRemaining = Number.isFinite(end)
      ? Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
      : null;
    return { ...slim, stats: { ...stats, daysRemaining }, tasks: sprintTasks.map(slimTask) };
  },
});
