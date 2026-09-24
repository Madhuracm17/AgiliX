import { HttpException } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Converts a tool handler's return value into an MCP tool result (JSON text). */
export function toToolResult(data: unknown): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? null, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Converts a thrown error into an MCP tool error result (isError: true). */
export function toToolError(error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: describeError(error) }], isError: true };
}

/**
 * Safe, client-facing error description.
 * - Nest HTTP exceptions keep their status and message (e.g. "Error 404: Project not found").
 * - Mongoose cast/validation errors become 400 messages.
 * - Anything else is reported generically; details only go to the server log (stderr).
 */
export function describeError(error: unknown): string {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    let message = error.message;

    if (typeof response === 'object' && response !== null && 'message' in response) {
      const responseMessage = (response as { message: unknown }).message;
      message = Array.isArray(responseMessage)
        ? responseMessage.join(', ')
        : String(responseMessage);
    }

    return `Error ${status}: ${message}`;
  }

  if (error instanceof Error && error.name === 'CastError') {
    return 'Error 400: Invalid id or value format';
  }

  if (error instanceof Error && error.name === 'ValidationError') {
    return `Error 400: ${error.message}`;
  }

  return 'Error 500: Internal error while running the tool. See the MCP server log (stderr) for details.';
}