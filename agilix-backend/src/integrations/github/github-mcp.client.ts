import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** GitHub's official remote MCP server. Override with GITHUB_MCP_URL if needed. */
const DEFAULT_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

/** Only the toolsets AgiliX needs, and only their read tools. */
const TOOLSETS = 'repos,pull_requests';

const CALL_TIMEOUT_MS = 30_000;

/**
 * MCP CLIENT for GitHub's remote MCP server.
 *
 * Here AgiliX is the client: it connects to https://api.githubcopilot.com/mcp/
 * over Streamable HTTP with a GitHub personal access token (GITHUB_MCP_TOKEN)
 * and calls GitHub's own MCP tools (list_commits, list_pull_requests, ...).
 * The connection is read-only (X-MCP-Readonly) and limited to two toolsets.
 *
 * The connection is opened on first use and reused. If a call fails because
 * the connection dropped, it reconnects once and retries.
 */
@Injectable()
export class GithubMcpClient implements OnModuleDestroy {
  private readonly logger = new Logger('GitHub MCP');
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  /** True when a token is set (the connection itself is only tested on use). */
  isConfigured(): boolean {
    return !!process.env.GITHUB_MCP_TOKEN?.trim();
  }

  /** Names of the tools GitHub's server offers us. Used by the status check. */
  async listToolNames(): Promise<string[]> {
    const client = await this.connect();
    const { tools } = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS });
    return tools.map((tool) => tool.name);
  }

  /**
   * Calls one GitHub MCP tool and returns its result parsed as JSON.
   * GitHub returns its data as JSON text in the first text content item.
   */
  async callJson<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    let result;
    try {
      result = await this.callOnce(name, args);
    } catch (error) {
      // A dropped or expired session: reconnect once and try again.
      this.logger.warn(`"${name}" failed (${describe(error)}), reconnecting once`);
      await this.reset();
      result = await this.callOnce(name, args).catch((retryError) => {
        throw new BadGatewayException(`GitHub MCP server did not answer: ${describe(retryError)}`);
      });
    }

    const text = (result.content as Array<{ type: string; text?: string }> | undefined)
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('');

    if (result.isError) {
      throw new BadGatewayException(`GitHub MCP tool "${name}" failed: ${(text ?? '').slice(0, 300)}`);
    }
    try {
      return JSON.parse(text ?? 'null') as T;
    } catch {
      throw new BadGatewayException(`GitHub MCP tool "${name}" did not return JSON.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }

  private async callOnce(name: string, args: Record<string, unknown>) {
    const client = await this.connect();
    return client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    const token = process.env.GITHUB_MCP_TOKEN?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'GitHub is not connected. Set GITHUB_MCP_TOKEN in agilix-backend/.env to a GitHub personal access token.',
      );
    }
    const url = process.env.GITHUB_MCP_URL?.trim() || DEFAULT_GITHUB_MCP_URL;

    this.connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-MCP-Toolsets': TOOLSETS,
            'X-MCP-Readonly': 'true',
          },
        },
      });
      const client = new Client({ name: 'agilix-backend', version: '1.0.0' });
      try {
        await client.connect(transport, { timeout: CALL_TIMEOUT_MS });
      } catch (error) {
        throw new BadGatewayException(
          `Could not connect to the GitHub MCP server (${describe(error)}). ` +
            'Check GITHUB_MCP_TOKEN and your internet connection.',
        );
      }
      this.logger.log(`Connected to ${url}`);
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async reset(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => undefined);
  }
}

/** Short error text without secrets (the token is only ever in a header). */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
