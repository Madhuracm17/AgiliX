import { z } from 'zod';
import { AnalyticsService } from '../../analytics/analytics.service';
import { requireRole } from '../../auth/roles';
import { KanbanReportsService } from '../../reports/kanban-reports.service';
import { ReportsService } from '../../reports/reports.service';
import { UserRole } from '../../users/schemas/user.schema';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId, requireTeamReports } from './tool-helpers';

/*
 * Report tools. Same rules as the web app: team-wide reports are for managers
 * and admins; developers and testers get only their own report.
 */

export const projectSummaryTool = defineMcpTool({
  name: 'agilix_get_project_summary',
  title: 'Project summary',
  description:
    'Managers and admins. Project-level numbers: total, to-do, in-progress and done tasks, completion ' +
    'percentage, total and completed story points, hours tracked, and the pace of the active sprint ' +
    '(finished share vs time gone by) where there is one.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(AnalyticsService).getProjectSummary(projectId);
  },
});

export const teamWorkloadTool = defineMcpTool({
  name: 'agilix_get_team_workload',
  title: 'Team workload',
  description:
    'Managers and admins. Per team member: tasks assigned, in progress, completed, hours tracked ' +
    'and completion percentage. Use it to spot overloaded or idle people.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(AnalyticsService).getWorkload(projectId);
  },
});

export const velocityTool = defineMcpTool({
  name: 'agilix_get_velocity',
  title: 'Sprint velocity',
  description:
    'Managers and admins, Scrum projects. Committed vs completed story points for each completed ' +
    'sprint, and the average velocity.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(ReportsService).getVelocity(projectId);
  },
});

export const burndownTool = defineMcpTool({
  name: 'agilix_get_burndown',
  title: 'Sprint burndown and burnup',
  description:
    'Managers and admins. Day-by-day remaining and completed story points for a sprint, with the ' +
    'ideal line, as used by the burndown and burnup charts.',
  readOnly: true,
  inputSchema: { sprintId: objectId('sprint') },
  handler: async ({ sprintId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertSprint(user, sprintId);
    return ctx.get(ReportsService).getSeries(sprintId);
  },
});

export const sprintReportTool = defineMcpTool({
  name: 'agilix_get_sprint_report',
  title: 'Sprint report',
  description:
    'Managers and admins. The sprint report: committed vs completed points, scope changes, and the ' +
    'completed and unfinished tasks. Best used for a finished sprint or a retrospective.',
  readOnly: true,
  inputSchema: { sprintId: objectId('sprint') },
  handler: async ({ sprintId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertSprint(user, sprintId);
    return ctx.get(ReportsService).getSprintReport(sprintId);
  },
});

export const kanbanReportTool = defineMcpTool({
  name: 'agilix_get_kanban_report',
  title: 'Kanban flow report',
  description:
    'Managers and admins, Kanban projects. Cumulative flow, throughput, cycle time and lead time ' +
    'over the last 14, 30 or 90 days (default 30).',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    days: z.union([z.literal(14), z.literal(30), z.literal(90)]).optional().describe('14, 30 or 90.'),
  },
  handler: async ({ projectId, days }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(KanbanReportsService).getReport(projectId, days ? String(days) : undefined);
  },
});

export const myReportTool = defineMcpTool({
  name: 'agilix_get_my_report',
  title: 'My report',
  description:
    'Managers, developers and testers. The current user\'s own report for a project: their tasks, ' +
    'progress and time tracked. Contains nobody else\'s data.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireRole(
      user,
      'You do not have permission to view reports. Please contact a manager.',
      UserRole.MANAGER,
      UserRole.DEVELOPER,
      UserRole.TESTER,
    );
    await access.assertProject(user, projectId);
    return ctx.get(ReportsService).getMyReport(projectId, user.userId, user.role);
  },
});
