import { z } from 'zod';
import { GithubActivityService } from '../../integrations/github/github-activity.service';
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
