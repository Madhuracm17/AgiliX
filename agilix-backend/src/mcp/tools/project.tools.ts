import { ProjectsService } from '../../projects/projects.service';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId, slimProject } from './tool-helpers';

/** Who the MCP server is acting as. Useful first call for an agent. */
export const whoAmITool = defineMcpTool({
  name: 'agilix_whoami',
  title: 'Who am I',
  description:
    'Returns the AgiliX account this MCP server acts as (name, email, role). Every other tool only ' +
    'shows what this account may see in the AgiliX web app. Call this first if a tool says access is denied.',
  readOnly: true,
  handler: async (_args, ctx) => {
    const user = await ctx.user();
    return { id: user.userId, name: user.name, email: user.email, role: user.role };
  },
});

export const listProjectsTool = defineMcpTool({
  name: 'agilix_list_projects',
  title: 'List projects',
  description:
    'Lists the AgiliX projects the current user can see (admins see all, everyone else only the ' +
    'projects they own or are a member of). Returns id, name, methodology (scrum or kanban), status, ' +
    'owner and members. Use the returned ids with the other agilix_* tools.',
  readOnly: true,
  handler: async (_args, ctx) => {
    const { user } = await actingUser(ctx);
    const projects = ctx.get(ProjectsService);
    const list = await projects.withPeople(await projects.findAll(user));
    return (Array.isArray(list) ? list : []).map(slimProject);
  },
});

export const getProjectTool = defineMcpTool({
  name: 'agilix_get_project',
  title: 'Get project',
  description:
    'Returns one project: name, description, methodology, status, WIP limit, owner and team members.',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);
    await access.assertProject(user, projectId);
    const projects = ctx.get(ProjectsService);
    return slimProject(await projects.withPeople(await projects.findOne(projectId, user)));
  },
});
