// MUST stay the first import: redirects console output and all Nest logs to stderr,
// and switches the working directory to agilix-backend before AppModule (and its
// .env loading) is evaluated.
import { BACKEND_ROOT, MCP_LOGGER } from './mcp-process-setup';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from '../app.module';
import { AGILIX_MCP_SERVER_INFO } from './mcp-server.constants';
import { createAgilixMcpServer } from './mcp-server.factory';
import { MCP_TOOLS } from './tools';

const logger = new Logger('AgiliX MCP');

let app: INestApplicationContext | undefined;
let server: McpServer | undefined;
let shuttingDown = false;

/** Idempotent shutdown: MCP server first, then the Nest context (closes MongoDB). */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.log(`Shutting down (${reason})`);

  try {
    await server?.close();
  } catch (error) {
    logger.error('Error while closing the MCP server', error instanceof Error ? error.stack : String(error));
  }

  try {
    await app?.close();
  } catch (error) {
    logger.error('Error while closing the Nest application context', error instanceof Error ? error.stack : String(error));
  }

  process.exit(exitCode);
}

async function main(): Promise<void> {
  logger.log(
    `Starting ${AGILIX_MCP_SERVER_INFO.name} MCP server v${AGILIX_MCP_SERVER_INFO.version} (stdio) in ${BACKEND_ROOT}`,
  );

  // Full AppModule (config, MongoDB connection, all services) without an HTTP server.
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: MCP_LOGGER,
    abortOnError: false,
  });

  server = createAgilixMcpServer(app, MCP_TOOLS);
  await server.connect(new StdioServerTransport());

  logger.log('AgiliX MCP server is ready on stdio');
}

// The SDK's stdio transport does not react when the client closes stdin, so do it here.
process.stdin.on('end', () => void shutdown('stdin closed by MCP client'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error.stack);
  void shutdown('uncaught exception', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason instanceof Error ? reason.stack : String(reason));
  void shutdown('unhandled rejection', 1);
});

main().catch((error) => {
  logger.error('Failed to start the AgiliX MCP server', error instanceof Error ? error.stack : String(error));
  void shutdown('startup failure', 1);
});