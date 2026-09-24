// AgiliX MCP foundation smoke test.
// Starts the built MCP server over stdio with the official MCP client and checks
// the handshake, tools/list, the agilix_server_info tool and clean shutdown.
//
// Usage (from agilix-backend):  npm run build   then   npm run mcp:test
// Requires MongoDB to be running and agilix-backend/.env to be configured.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(backendRoot, 'dist', 'mcp', 'mcp-main.js');

// Allows for MongoDB start-up/retries (Mongoose retries for about 27 seconds).
const REQUEST_TIMEOUT_MS = 60_000;
// The MCP client force-stops the server after 2 s if it does not exit by itself.
const CLEAN_EXIT_LIMIT_MS = 1_900;

let passed = true;
function check(condition, message) {
  console.log(`${condition ? '✔' : '✖'} ${message}`);
  if (!condition) passed = false;
}

if (!existsSync(serverEntry)) {
  console.error(`✖ ${serverEntry} not found. Run "npm run build" first.`);
  process.exit(1);
}

console.log(`AgiliX MCP smoke test — starting ${path.relative(backendRoot, serverEntry)}`);
console.log('(Server log lines below come from the MCP server on stderr.)\n');

// Pass the current environment through (the MCP client otherwise only passes a minimal set).
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
);

const transport = new StdioClientTransport({
  command: process.execPath, // the same node.exe that runs this script
  args: [serverEntry],
  cwd: backendRoot,
  env,
  stderr: 'inherit',
});

const client = new Client({ name: 'agilix-mcp-smoke-test', version: '1.0.0' });
let connected = false;

try {
  await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
  connected = true;

  const serverVersion = client.getServerVersion();
  check(
    serverVersion?.name === 'agilix',
    `Connected to MCP server "${serverVersion?.name}" v${serverVersion?.version}`,
  );

  const { tools } = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
  const toolNames = tools.map((tool) => tool.name);
  check(
    toolNames.includes('agilix_server_info'),
    `tools/list returned ${tools.length} tool(s): ${toolNames.join(', ')}`,
  );

  const serverInfoTool = tools.find((tool) => tool.name === 'agilix_server_info');
  check(serverInfoTool?.annotations?.readOnlyHint === true, 'agilix_server_info is marked read-only');

  const result = await client.callTool(
    { name: 'agilix_server_info', arguments: {} },
    undefined,
    { timeout: REQUEST_TIMEOUT_MS },
  );
  check(!result.isError, 'agilix_server_info returned without error');

  const text = result.content?.find((item) => item.type === 'text')?.text ?? '';
  let info;
  try {
    info = JSON.parse(text);
  } catch {
    info = undefined;
  }

  check(info?.nestContext === 'ready', 'NestJS application context is ready');
  check(info?.database?.state === 'connected', `MongoDB connection state: ${info?.database?.state}`);

  console.log('\nagilix_server_info result:');
  console.log(text);
} catch (error) {
  passed = false;
  console.error(`✖ Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  const closeStartedAt = Date.now();
  await client.close().catch(() => {});
  const closeMs = Date.now() - closeStartedAt;

  if (connected) {
    check(
      closeMs < CLEAN_EXIT_LIMIT_MS,
      `Server exited cleanly after the client closed stdin (${closeMs} ms)`,
    );
  }
}

console.log(passed ? '\nPASSED — AgiliX MCP server foundation works.' : '\nFAILED — see the messages above.');
process.exit(passed ? 0 : 1);