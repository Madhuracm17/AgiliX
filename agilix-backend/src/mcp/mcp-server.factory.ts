import { INestApplicationContext, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AGILIX_MCP_SERVER_INFO,
  MCP_WRITE_TOOLS_ENABLED,
} from './mcp-server.constants';
import { toToolResult } from './mcp-results';
import type {
  AnyMcpToolDefinition,
  McpToolContext,
} from './mcp-tool.types';

/*
 * McpServer.registerTool() is generic over each tool's input schema.
 * The registry contains tools with different schemas, so the SDK callback
 * is intentionally typed loosely at this boundary.
 *
 * Individual tools remain strongly typed through McpToolDefinition /
 * defineMcpTool.
 */
type SdkToolCallback = (
  ...callbackArgs: unknown[]
) => Promise<CallToolResult>;

type SdkRegisterTool = (
  name: string,
  config: Record<string, unknown>,
  callback: SdkToolCallback,
) => unknown;

/**
 * Creates the AgiliX MCP server and registers the given tools.
 *
 * The MCP server uses the existing Nest application context so MCP tools
 * can resolve and use existing Nest services without starting another
 * HTTP server.
 */
export function createAgilixMcpServer(
  app: INestApplicationContext,
  tools: AnyMcpToolDefinition[],
): McpServer {
  const logger = new Logger('AgiliX MCP');

  const server = new McpServer({
    name: AGILIX_MCP_SERVER_INFO.name,
    version: AGILIX_MCP_SERVER_INFO.version,
  });

  const context: McpToolContext = {
    get: (token) => app.get(token, { strict: false }),
  };

  /*
   * The MCP SDK has generic registerTool() typings because every tool may
   * have a different input schema. Our registry intentionally stores
   * heterogeneous tools, so we cast only this registration boundary.
   */
  const registerTool =
    server.registerTool.bind(server) as unknown as SdkRegisterTool;

  const registeredNames = new Set<string>();

  for (const tool of tools) {
    if (registeredNames.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: "${tool.name}"`);
    }

    if (!tool.readOnly && !MCP_WRITE_TOOLS_ENABLED) {
      throw new Error(
        `MCP tool "${tool.name}" changes data, but write tools are disabled ` +
          '(MCP_WRITE_TOOLS_ENABLED = false in src/mcp/mcp-server.constants.ts).',
      );
    }

    const hasInputSchema = tool.inputSchema !== undefined;

    registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        ...(hasInputSchema
          ? { inputSchema: tool.inputSchema }
          : {}),
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          openWorldHint: false,
        },
      },
      async (...callbackArgs: unknown[]): Promise<CallToolResult> => {
        /*
         * The MCP SDK passes:
         *
         *   (args, extra)
         *
         * for tools with an input schema.
         *
         * For tools without an input schema, there are no user arguments,
         * so we use an empty object.
         */
        const args: Record<string, unknown> = hasInputSchema
          ? isRecord(callbackArgs[0])
            ? callbackArgs[0]
            : {}
          : {};

        try {
          return toToolResult(await tool.handler(args, context));
        } catch (error) {
          logger.error(
            `Tool "${tool.name}" failed`,
            error instanceof Error ? error.stack : String(error),
          );

          return toToolResult({
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  error instanceof Error
                    ? error.message
                    : String(error),
              },
            ],
          });
        }
      },
    );

    registeredNames.add(tool.name);
  }

  logger.log(
    `Registered ${registeredNames.size} MCP tool(s): ${
      [...registeredNames].join(', ') || '(none)'
    }`,
  );

  return server;
}

/**
 * Runtime guard used at the MCP SDK boundary.
 *
 * MCP tool arguments arrive from an external process, so we should not
 * assume that an unknown value is already a Record<string, unknown>.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}