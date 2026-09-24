import type { AnyMcpToolDefinition } from '../mcp-tool.types';
import { serverInfoTool } from './server-info.tool';

/**
 * Every tool exposed by the AgiliX MCP server.
 *
 * To add a tool:
 *  1. Create src/mcp/tools/<name>.tool.ts using defineMcpTool(...).
 *  2. Import it here and add it to this array.
 *  3. Run `npm run build`, then `npm run mcp:test` or `npm run mcp:inspect`.
 */
export const MCP_TOOLS: AnyMcpToolDefinition[] = [
  // Foundation: permanent read-only health / connectivity check.
  serverInfoTool,

  // Business tools are added below by the MCP tools owner.
];