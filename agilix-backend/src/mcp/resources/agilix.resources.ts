import { ActivityService } from '../../collaboration/activity.service';
import { CommentsService } from '../../collaboration/comments.service';
import type { McpToolContext } from '../mcp-tool.types';
import { projectActivityTool } from '../tools/collaboration.tools';
import { getProjectTool, listProjectsTool } from '../tools/project.tools';
import { listSprintsTool } from '../tools/sprint.tools';
import { getTaskTimeTool, listTasksTool } from '../tools/task.tools';
import { actingUser } from '../tools/tool-helpers';
import { WORKFLOW_GUIDE } from './workflow-guide';

/*
 * MCP RESOURCES: read-only AgiliX data that an MCP client (Claude Desktop, MCP
 * Inspector...) can list and attach as context, addressed by agilix:// URIs.
 *
 * Every resource is built from the existing read tools (or services after the
 * same access check), so a resource can never show more than the tools, and
 * the tools never more than the web app.
 */

export type ResourceVariables = Record<string, string>;

export interface McpResourceDefinition {
  name: string;
  title: string;
  description: string;
  mimeType: 'application/json' | 'text/markdown';
  /** A fixed address, e.g. agilix://projects. */
  uri?: string;
  /** An address with variables, e.g. agilix://projects/{projectId}. */
  uriTemplate?: string;
  /** Lists the concrete resources of a template (shown in the client's resource picker). */
  list?: (ctx: McpToolContext) => Promise<Array<{ uri: string; name: string; title?: string; description?: string }>>;
  /** Returns the content: a string for markdown, anything else is sent as JSON. */
  read: (vars: ResourceVariables, ctx: McpToolContext) => Promise<unknown>;
}

const COLUMNS = ['todo', 'in_progress', 'review', 'done'] as const;

type SlimProject = { id: string; name: string; methodology: string };
type SlimTask = { id: string; title: string; status: string; sprintId: string | null } & Record<string, unknown>;
type SlimSprint = { id: string; name: string; status: string } & Record<string, unknown>;

const projectsOf = async (ctx: McpToolContext) => (await listProjectsTool.handler({}, ctx)) as SlimProject[];
const tasksOf = async (projectId: string, ctx: McpToolContext, backlogOnly = false) =>
  (await listTasksTool.handler({ projectId, backlogOnly }, ctx)) as SlimTask[];
const sprintsOf = async (projectId: string, ctx: McpToolContext) =>
  (await listSprintsTool.handler({ projectId }, ctx)) as SlimSprint[];

/** One entry per visible project for a template such as agilix://projects/{projectId}/board. */
function perProject(suffix: string, label: string) {
  return async (ctx: McpToolContext) =>
    (await projectsOf(ctx)).map((p) => ({
      uri: `agilix://projects/${p.id}${suffix}`,
      name: `${p.name}${label}`,
      title: `${p.name}${label}`,
    }));
}

export const workflowGuideResource: McpResourceDefinition = {
  name: 'agilix-workflow-guide',
  title: 'How AgiliX works',
  description:
    'Roles, task statuses, the Scrum and Kanban rules, approvals and what the AI insights measure. ' +
    'Read this first so suggestions follow the team\'s actual process.',
  mimeType: 'text/markdown',
  uri: 'agilix://guide/workflow',
  read: async () => WORKFLOW_GUIDE,
};

export const projectsResource: McpResourceDefinition = {
  name: 'agilix-projects',
  title: 'My projects',
  description: 'Every project the MCP account can see, with methodology, status, owner and members.',
  mimeType: 'application/json',
  uri: 'agilix://projects',
  read: async (_vars, ctx) => projectsOf(ctx),
};

export const projectOverviewResource: McpResourceDefinition = {
  name: 'agilix-project',
  title: 'Project overview',
  description:
    'One project at a glance: team, active sprint, task counts per column, unassigned and backlog work, ' +
    'and the 10 most recent activity entries.',
  mimeType: 'application/json',
  uriTemplate: 'agilix://projects/{projectId}',
  list: perProject('', ''),
  read: async ({ projectId }, ctx) => {
    const project = (await getProjectTool.handler({ projectId }, ctx)) as SlimProject; // access check
    const [tasks, sprints, activity] = await Promise.all([
      tasksOf(projectId, ctx),
      sprintsOf(projectId, ctx),
      ctx.get(ActivityService).forProject(projectId, 10),
    ]);
    const active = sprints.find((s) => s.status === 'active') ?? null;
    const counts = Object.fromEntries(COLUMNS.map((c) => [c, tasks.filter((t) => t.status === c).length]));
    return {
      project,
      activeSprint: active,
      plannedSprints: sprints.filter((s) => s.status === 'planned').map((s) => ({ id: s.id, name: s.name })),
      tasks: {
        total: tasks.length,
        byColumn: counts,
        unassignedOpen: tasks.filter((t) => !t.assignee && t.status !== 'done').length,
        inBacklog: tasks.filter((t) => !t.sprintId && t.status !== 'done').length,
      },
      recentActivity: activity,
      related: {
        board: `agilix://projects/${projectId}/board`,
        backlog: `agilix://projects/${projectId}/backlog`,
        activity: `agilix://projects/${projectId}/activity`,
      },
    };
  },
};

export const boardResource: McpResourceDefinition = {
  name: 'agilix-board',
  title: 'Board',
  description:
    'The board as the team sees it, task by task in To do / In progress / Review / Done. Scrum: the active ' +
    'sprint only. Kanban: every task.',
  mimeType: 'application/json',
  uriTemplate: 'agilix://projects/{projectId}/board',
  list: perProject('/board', ' — board'),
  read: async ({ projectId }, ctx) => {
    const project = (await getProjectTool.handler({ projectId }, ctx)) as SlimProject;
    const [tasks, sprints] = await Promise.all([tasksOf(projectId, ctx), sprintsOf(projectId, ctx)]);
    const active = sprints.find((s) => s.status === 'active') ?? null;
    const scrum = project.methodology !== 'kanban';
    const onBoard = scrum ? (active ? tasks.filter((t) => t.sprintId === active.id) : []) : tasks;
    return {
      project: { id: project.id, name: project.name, methodology: project.methodology },
      sprint: scrum ? active : undefined,
      note: scrum && !active ? 'No active sprint: the Scrum board is empty.' : undefined,
      columns: Object.fromEntries(COLUMNS.map((c) => [c, onBoard.filter((t) => t.status === c)])),
    };
  },
};

export const backlogResource: McpResourceDefinition = {
  name: 'agilix-backlog',
  title: 'Backlog',
  description: 'Tasks not in any sprint (Scrum product backlog), with priority, story points and assignee.',
  mimeType: 'application/json',
  uriTemplate: 'agilix://projects/{projectId}/backlog',
  list: perProject('/backlog', ' — backlog'),
  read: async ({ projectId }, ctx) => {
    const tasks = await tasksOf(projectId, ctx, true);
    const open = tasks.filter((t) => t.status !== 'done');
    return {
      projectId,
      openTasks: open.length,
      unestimated: open.filter((t) => !t.storyPoints).length,
      tasks: open,
    };
  },
};

export const activityResource: McpResourceDefinition = {
  name: 'agilix-activity',
  title: 'Activity log',
  description: 'The project\'s 50 most recent activity entries: who did what, and when.',
  mimeType: 'application/json',
  uriTemplate: 'agilix://projects/{projectId}/activity',
  list: perProject('/activity', ' — activity'),
  read: async ({ projectId }, ctx) => projectActivityTool.handler({ projectId, limit: 50 }, ctx),
};

export const taskResource: McpResourceDefinition = {
  name: 'agilix-task',
  title: 'Task with discussion',
  description: 'One task with its comments, its history from the activity log, and the time tracked on it.',
  mimeType: 'application/json',
  uriTemplate: 'agilix://tasks/{taskId}',
  read: async ({ taskId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    const { projectId } = await access.assertTask(user, taskId);
    const [tasks, comments, history, time] = await Promise.all([
      tasksOf(projectId, ctx),
      ctx.get(CommentsService).list(user, taskId),
      ctx.get(ActivityService).forTask(taskId),
      getTaskTimeTool.handler({ taskId }, ctx) as Promise<{ totalHours: number }>,
    ]);
    return {
      task: tasks.find((t) => t.id === taskId) ?? null,
      projectId,
      comments,
      history,
      trackedHours: time.totalHours,
    };
  },
};

/** Every resource the AgiliX MCP server offers. */
export const MCP_RESOURCES: McpResourceDefinition[] = [
  workflowGuideResource,
  projectsResource,
  projectOverviewResource,
  boardResource,
  backlogResource,
  activityResource,
  taskResource,
];
