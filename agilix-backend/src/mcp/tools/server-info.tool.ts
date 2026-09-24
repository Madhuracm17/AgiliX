import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AGILIX_MCP_SERVER_INFO } from '../mcp-server.constants';
import { defineMcpTool } from '../mcp-tool.types';

const DATABASE_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Permanent foundation tool: read-only health / connectivity check.
 * Reports server identity, NestJS application-context status and the MongoDB
 * connection state. It reads no project data and never changes anything.
 */
export const serverInfoTool = defineMcpTool({
  name: 'agilix_server_info',
  title: 'AgiliX MCP server info',
  description:
    'Read-only health check for the AgiliX MCP server. Returns the server name and version, ' +
    'whether the NestJS application context is ready, and the MongoDB connection state. ' +
    'Does not read or change any project data.',
  readOnly: true,
  handler: (_args, ctx) => {
    const connection = ctx.get<Connection>(getConnectionToken());
    const databaseState = DATABASE_STATES[connection.readyState] ?? 'unknown';

    return {
      status: databaseState === 'connected' ? 'ok' : 'degraded',
      server: AGILIX_MCP_SERVER_INFO.name,
      version: AGILIX_MCP_SERVER_INFO.version,
      transport: 'stdio',
      nestContext: 'ready',
      database: {
        state: databaseState,
        name: connection.name,
      },
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  },
});