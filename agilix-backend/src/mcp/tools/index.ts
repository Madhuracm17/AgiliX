import type { AnyMcpToolDefinition } from '../mcp-tool.types';
import { serverInfoTool } from './server-info.tool';
import { getProjectTool, listProjectsTool, whoAmITool } from './project.tools';
import { getTaskTimeTool, listTasksTool } from './task.tools';
import { getSprintTool, listSprintsTool } from './sprint.tools';
import {
  burndownTool,
  kanbanReportTool,
  myReportTool,
  projectSummaryTool,
  sprintReportTool,
  teamWorkloadTool,
  velocityTool,
} from './report.tools';
import {
  estimateStoryPointsTool,
  kanbanInsightsTool,
  predictSprintRiskTool,
  recommendPriorityTool,
  suggestTasksTool,
} from './ai.tools';
import {
  burnoutRiskTool,
  calendarLoadTool,
  githubActivityTool,
  sprintHealthTool,
  standupTool,
} from './integration.tools';
import { listCommentsTool, projectActivityTool } from './collaboration.tools';
import { MCP_WRITE_TOOLS } from './write.tools';
import { MCP_WRITE_TOOLS_ENABLED } from '../mcp-server.constants';

/**
 * Every tool exposed by the AgiliX MCP server.
 *
 * To add a tool:
 *  1. Create or extend a file in src/mcp/tools/ using defineMcpTool(...).
 *     Resolve the acting user with ctx.user() and run the same AccessService /
 *     requireRole checks as the matching HTTP route (see tool-helpers.ts).
 *  2. Import it here and add it to this array.
 *  3. Run `npm run build`, then `npm run mcp:test` or `npm run mcp:inspect`.
 */
export const MCP_TOOLS: AnyMcpToolDefinition[] = [
  // Foundation: permanent read-only health / connectivity check (needs no account).
  serverInfoTool,

  // Identity and projects
  whoAmITool,
  listProjectsTool,
  getProjectTool,

  // Tasks and time
  listTasksTool,
  getTaskTimeTool,

  // Sprints
  listSprintsTool,
  getSprintTool,

  // Reports (team reports: managers and admins only)
  projectSummaryTool,
  teamWorkloadTool,
  velocityTool,
  burndownTool,
  sprintReportTool,
  kanbanReportTool,
  myReportTool,

  // AI (suggest only, nothing is saved; each call can take up to ~30 s)
  predictSprintRiskTool,
  estimateStoryPointsTool,
  recommendPriorityTool,
  suggestTasksTool,
  kanbanInsightsTool,

  // Outside data read through other MCP servers (AgiliX as MCP client)
  githubActivityTool,
  calendarLoadTool,

  // AI insights over the combined context (AgiliX + GitHub MCP + Google Calendar)
  burnoutRiskTool,
  sprintHealthTool,
  standupTool,

  // Collaboration: comments and the activity log
  listCommentsTool,
  projectActivityTool,

  // Tools that change data. They run the SAME checks as the web app (they call the
  // HTTP controllers), and are only registered when MCP_WRITE_TOOLS_ENABLED is true.
  ...(MCP_WRITE_TOOLS_ENABLED ? MCP_WRITE_TOOLS : []),
];
