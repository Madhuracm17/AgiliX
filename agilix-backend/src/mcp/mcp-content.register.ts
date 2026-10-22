import { Logger } from '@nestjs/common';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeError } from './mcp-results';
import type { McpToolContext } from './mcp-tool.types';
import { MCP_PROMPTS, type McpPromptDefinition } from './prompts/agilix.prompts';
import { MCP_RESOURCES, type McpResourceDefinition, type ResourceVariables } from './resources/agilix.resources';

/*
 * Registers the AgiliX MCP RESOURCES and PROMPTS (the tools are registered by
 * createAgilixMcpServer). Called from mcp-server.factory.ts with the same tool
 * context, so resources and prompts act as the same MCP_USER_EMAIL account.
 *
 * As with the tools, failures reach the client as a safe message
 * ("Error 403: ...") and the details stay in the server log.
 */

const logger = new Logger('AgiliX MCP');

/** Turns a resource's content into the MCP "contents" shape. */
function toContents(uri: string, mimeType: string, data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? null, null, 2);
  return { contents: [{ uri, mimeType, text }] };
}

/** Template variables arrive as string or string[]; AgiliX only uses single values. */
function single(variables: Record<string, string | string[]>): ResourceVariables {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? '') : String(value)]),
  );
}

async function safely<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.error(`${what} failed`, error instanceof Error ? error.stack : String(error));
    throw new Error(describeError(error));
  }
}

export function registerAgilixResources(
  server: McpServer,
  ctx: McpToolContext,
  resources: McpResourceDefinition[] = MCP_RESOURCES,
): void {
  for (const r of resources) {
    const metadata = { title: r.title, description: r.description, mimeType: r.mimeType };
    if (r.uri) {
      server.registerResource(r.name, r.uri, metadata, async (uri: URL) =>
        safely(`Resource ${uri.href}`, async () => toContents(uri.href, r.mimeType, await r.read({}, ctx))),
      );
    } else if (r.uriTemplate) {
      const template = new ResourceTemplate(r.uriTemplate, {
        list: r.list
          ? async () =>
              safely(`Listing ${r.uriTemplate}`, async () => ({
                resources: (await r.list!(ctx)).map((item) => ({ ...item, mimeType: r.mimeType })),
              }))
          : undefined,
      });
      server.registerResource(r.name, template, metadata, async (uri: URL, variables: Record<string, string | string[]>) =>
        safely(`Resource ${uri.href}`, async () => toContents(uri.href, r.mimeType, await r.read(single(variables), ctx))),
      );
    }
  }
  logger.log(`Registered ${resources.length} MCP resource(s): ${resources.map((r) => r.uri ?? r.uriTemplate).join(', ')}`);
}

export function registerAgilixPrompts(
  server: McpServer,
  ctx: McpToolContext,
  prompts: McpPromptDefinition[] = MCP_PROMPTS,
): void {
  // registerPrompt is generic over each prompt's argument shape; the registry holds
  // different shapes, so the boundary is typed loosely (as registerTool is in the factory).
  const registerPrompt = server.registerPrompt.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; argsSchema: Record<string, unknown> },
    callback: (args: Record<string, string | undefined>) => Promise<unknown>,
  ) => unknown;

  for (const p of prompts) {
    registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.args }, async (args) =>
      safely(`Prompt ${p.name}`, async () => ({ description: p.description, messages: await p.build(args ?? {}, ctx) })),
    );
  }
  logger.log(`Registered ${prompts.length} MCP prompt(s): ${prompts.map((p) => p.name).join(', ')}`);
}
