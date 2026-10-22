import { z } from 'zod';
import { GithubActivityService } from '../../integrations/github/github-activity.service';
import { GoogleCalendarService } from '../../integrations/google-calendar/google-calendar.service';
import { BurnoutRiskService } from '../../insights/burnout-risk.service';
import { SprintHealthService } from '../../insights/sprint-health.service';
import { StandupService } from '../../insights/standup.service';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId, requireTeamReports } from './tool-helpers';

export const githubActivityTool = defineMcpTool({
  name: 'agilix_get_github_activity',
  title: 'GitHub activity per team member',
  description:
    'Managers and admins. Reads the project\'s linked GitHub repository through the GitHub MCP server ' +
    'and returns, per team member: commits, late-night (22:00–06:00) and weekend commits, last commit, ' +
    'pull requests opened / merged / still open / stale (open > 3 days) and reviews given, plus daily ' +
    'commit counts for the whole team. Window: last 7, 14 or 30 days (default 14).',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional().describe('7, 14 or 30.'),
  },
  handler: async ({ projectId, days }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(GithubActivityService).getActivity(projectId, days);
  },
});

export const calendarLoadTool = defineMcpTool({
  name: 'agilix_get_meeting_load',
  title: 'Meeting load per team member (Google Calendar)',
  description:
    'Managers and admins. Reads the Google Calendars that team members connected (meeting TIMES only; ' +
    'titles and attendees are never read) and returns, per member: meeting hours and count, average meeting ' +
    'hours per working day, heaviest day, back-to-back meetings, days with 4+ meetings, late-night and weekend ' +
    'meeting hours, out-of-office days, and the next 7 days (hours booked, out-of-office days) for sprint capacity. ' +
    'Members who have not connected a calendar have status "not_connected". Window: last 7, 14 or 30 days (default 14).',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional().describe('7, 14 or 30.'),
  },
  handler: async ({ projectId, days }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(GoogleCalendarService).projectReport(projectId, days);
  },
});

export const burnoutRiskTool = defineMcpTool({
  name: 'agilix_predict_burnout_risk',
  title: 'AI: burnout risk per team member',
  description:
    'Managers and admins. Collects each team member\'s work signals for the last 7, 14 or 30 days ' +
    '(tracked hours, late-night and weekend work, consecutive working days, open and ageing tasks, and ' +
    'GitHub commits / PRs / reviews from the GitHub MCP server, meeting load from Google Calendar) and has the LLM assess burnout risk: ' +
    'low / medium / high, a 0-100 score, reasons quoting the numbers, and recommendations for the manager. ' +
    'The measured signals are included as evidence. Takes up to about 30 seconds; results are cached for 10 minutes.',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional().describe('7, 14 or 30.'),
    refresh: z.boolean().optional().describe('true = ignore the 10-minute cache.'),
  },
  handler: async ({ projectId, days, refresh }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(BurnoutRiskService).assess(projectId, days, refresh ?? false);
  },
});

export const sprintHealthTool = defineMcpTool({
  name: 'agilix_get_sprint_health',
  title: 'AI: sprint / flow health',
  description:
    'Managers and admins. For a Scrum project with an active sprint: progress vs time, scope changes, ' +
    'ageing work, velocity and GitHub activity are judged by the LLM into healthy / at_risk / critical, a 0-100 ' +
    'score, a completion forecast, risks and recommendations. For Kanban (or no active sprint) it judges flow ' +
    'health instead: WIP vs limit, throughput trend, cycle time, items stuck in progress. Facts are included ' +
    'as evidence. Takes up to about 30 seconds; results are cached for 10 minutes.',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    refresh: z.boolean().optional().describe('true = ignore the 10-minute cache.'),
  },
  handler: async ({ projectId, refresh }, ctx) => {
    const { user, access } = await actingUser(ctx);
    requireTeamReports(user);
    await access.assertProject(user, projectId);
    return ctx.get(SprintHealthService).assess(projectId, refresh ?? false);
  },
});

export const standupTool = defineMcpTool({
  name: 'agilix_get_standup_summary',
  title: 'AI: daily standup summary',
  description:
    'Any project member. The daily standup written by the LLM from recorded activity since the previous ' +
    'working day: per person what they did (tasks moved or finished, commit messages from the GitHub MCP ' +
    'server), what they will work on today, and blockers (work sent back from review, tasks stuck in ' +
    'progress), plus a one-line team headline. Can take up to a minute; cached for 10 minutes.',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project'),
    refresh: z.boolean().optional().describe('true = ignore the 10-minute cache.'),
  },
  handler: async ({ projectId, refresh }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    return ctx.get(StandupService).summarize(projectId, refresh ?? false);
  },
});
