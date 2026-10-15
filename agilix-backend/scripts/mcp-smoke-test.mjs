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

  // ---- Business tools ----
  const EXPECTED_TOOLS = [
    'agilix_whoami',
    'agilix_list_projects',
    'agilix_get_project',
    'agilix_list_tasks',
    'agilix_get_task_time',
    'agilix_list_sprints',
    'agilix_get_sprint',
    'agilix_get_project_summary',
    'agilix_get_team_workload',
    'agilix_get_velocity',
    'agilix_get_burndown',
    'agilix_get_sprint_report',
    'agilix_get_kanban_report',
    'agilix_get_my_report',
    // AI tools: only checked for registration here, because each call uses the LLM (slow, costs credits).
    'agilix_predict_sprint_risk',
    'agilix_estimate_story_points',
    'agilix_recommend_priority',
    'agilix_suggest_tasks',
    'agilix_get_kanban_insights',
  ];
  const missing = EXPECTED_TOOLS.filter((name) => !toolNames.includes(name));
  check(missing.length === 0, `All ${EXPECTED_TOOLS.length} business tools are registered${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  check(
    tools.every((tool) => tool.annotations?.readOnlyHint === true),
    'Every registered tool is read-only',
  );

  const call = (name, args = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: REQUEST_TIMEOUT_MS });
  const textOf = (r) => r.content?.find((item) => item.type === 'text')?.text ?? '';

  if (!info?.actingAs) {
    // Not linked to an account: business tools must refuse with a real error.
    const denied = await call('agilix_whoami');
    check(
      denied.isError === true && textOf(denied).startsWith('Error 401'),
      'Without MCP_USER_EMAIL, business tools return Error 401 (isError: true)',
    );
    console.log('  (Set MCP_USER_EMAIL in .env to also test the tools with real data.)');
  } else {
    const me = await call('agilix_whoami');
    check(!me.isError, `agilix_whoami → ${textOf(me).replace(/\s+/g, ' ').slice(0, 120)}`);

    const projectsResult = await call('agilix_list_projects');
    check(!projectsResult.isError, 'agilix_list_projects returned without error');
    let projects = [];
    try { projects = JSON.parse(textOf(projectsResult)); } catch { /* checked below */ }
    check(Array.isArray(projects), `agilix_list_projects returned ${projects.length} project(s)`);

    if (projects.length > 0) {
      const projectId = projects[0].id;
      const tasks = await call('agilix_list_tasks', { projectId });
      check(!tasks.isError, `agilix_list_tasks on "${projects[0].name}" returned without error`);
    }

    // A badly formed id must come back as a 400 tool error, not a crash or a "success".
    const bad = await call('agilix_get_project', { projectId: 'not-an-id' });
    check(
      bad.isError === true && textOf(bad).startsWith('Error 400'),
      `Invalid id is rejected: ${textOf(bad)}`,
    );
  }
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

console.log(passed ? '\nPASSED — AgiliX MCP server works.' : '\nFAILED — see the messages above.');
process.exit(passed ? 0 : 1);