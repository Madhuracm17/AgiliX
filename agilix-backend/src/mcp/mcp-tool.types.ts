import type { Type } from '@nestjs/common';
import type { z } from 'zod';

/** Tool input described as a zod "raw shape", e.g. { projectId: z.string() }. */
export type McpInputShape = Record<string, z.ZodType>;

/** Parsed, typed arguments a tool handler receives for a given input shape. */
export type McpToolArgs<Shape extends McpInputShape> = z.infer<z.ZodObject<Shape>>;

/** What a tool handler can use from AgiliX. */
export interface McpToolContext {
  /**
   * Resolves any existing AgiliX provider from the running Nest application
   * context, e.g. ctx.get(ProjectsService). Tools must call existing services
   * instead of duplicating business logic.
   */
  get<T = unknown>(token: Type<T> | string | symbol): T;
}

/** Definition of one MCP tool. */
export interface McpToolDefinition<Shape extends McpInputShape = Record<string, never>> {
  /** Unique tool name, snake_case, e.g. "agilix_server_info". */
  name: string;
  /** Short human-readable title shown by MCP clients. */
  title?: string;
  /** What the tool does, written for the AI agent that decides when to call it. */
  description: string;
  /** Input arguments as a zod raw shape. Omit it for tools without arguments. */
  inputSchema?: Shape;
  /**
   * true  = only reads data.
   * false = changes data; refused while MCP_WRITE_TOOLS_ENABLED is false.
   */
  readOnly: boolean;
  /**
   * Returns plain data (it is converted to MCP text content by the factory).
   * Throw normal Nest exceptions (NotFoundException, BadRequestException, ...);
   * they are converted to MCP tool errors by the factory.
   */
  handler: (args: McpToolArgs<Shape>, ctx: McpToolContext) => unknown | Promise<unknown>;
}

/** A tool with any input shape; used by the registry. */
export type AnyMcpToolDefinition = McpToolDefinition<any>;

/** Helper that keeps full type inference for a tool's arguments. */
export function defineMcpTool<Shape extends McpInputShape = Record<string, never>>(
  tool: McpToolDefinition<Shape>,
): McpToolDefinition<Shape> {
  return tool;
}