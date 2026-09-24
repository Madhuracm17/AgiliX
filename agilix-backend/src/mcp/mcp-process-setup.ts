/**
 * Process setup for the AgiliX MCP server.
 *
 * IMPORTANT: this MUST be the first import in mcp-main.ts. It runs before
 * AppModule is loaded because:
 *
 *  1. stdout is reserved for MCP protocol messages, so console output and all
 *     Nest logs must go to stderr from the very first line.
 *  2. ConfigModule reads `.env` from the current working directory at the moment
 *     app.module is loaded (MONGODB_URI is read at that moment too). MCP clients
 *     such as Claude Desktop or MCP Inspector start this process from their own
 *     folder, so we switch to the agilix-backend folder first.
 */
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { StderrLogger, redirectConsoleToStderr } from './stderr-logger';

redirectConsoleToStderr();

/** Shared logger instance: every Nest log line in the MCP process goes to stderr. */
export const MCP_LOGGER = new StderrLogger();
Logger.overrideLogger(MCP_LOGGER);

/** The agilix-backend folder. This file lives in src/mcp/ and compiles to dist/mcp/. */
export const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
process.chdir(BACKEND_ROOT);