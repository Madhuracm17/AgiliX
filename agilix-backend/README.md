# Agilix Backend

NestJS + MongoDB backend for Agilix. Phase 1: core CRUD + Kanban/backlog/sprint
plumbing + the AI sprint-risk centerpiece.

## Structure

```
src/
  users/        User accounts + roles (admin/manager/developer)
  projects/     Projects, ownership, members
  tasks/        Kanban tasks — status, priority, backlog vs sprint assignment
  sprints/      Sprint creation + date range + team velocity
  ai/           AI sprint-risk prediction (Claude API call, structured JSON out)
```

## Setup

```bash
cp .env.example .env      # fill in MONGODB_URI and ANTHROPIC_API_KEY
npm install
npm run start:dev
```

Requires a running MongoDB instance (local or Atlas).

## Core flow

1. Create a project (`POST /projects`), add members.
2. Create tasks under it (`POST /tasks`) — they land in the backlog (no sprint).
3. Create a sprint (`POST /sprints`), pull backlog tasks into it
   (`PATCH /tasks/:id/sprint/:sprintId`).
4. Move tasks across the board (`PATCH /tasks/:id` with `status`).
5. Pull sprint stats for burndown/velocity charts (`GET /tasks/sprint/:sprintId/stats`).
6. Get the AI risk verdict (`GET /ai/sprint-risk/:sprintId`) — calls Claude with
   the sprint's progress/timing/velocity and returns
   `{ risk: green|yellow|red, reasoning, completionForecastPercent }`.

## Why an LLM call instead of a trained model

Story-point/priority/sprint-risk prediction needs historical labeled data
(past tickets with outcomes) that a student project doesn't have. Rather than
faking that with synthetic data, sprint risk is computed by feeding live
sprint stats into an LLM with a structured-JSON prompt. Same "AI-powered"
outcome, no fabricated training data, and it's honestly more accurate than a
toy classifier would be at this scale.

## Not yet built (next steps)

- React/Redux frontend (Kanban board, backlog, sprint board, dashboards)
- Burndown/velocity chart rendering (data already available via
  `/tasks/sprint/:sprintId/stats`)
- Auth/JWT (currently password is hashed but there's no login/session yet)
- AWS deployment

## MCP Server (Model Context Protocol)

AgiliX includes an MCP server so AI agents (MCP Inspector, Claude Desktop, …) can
talk to AgiliX through tools. It is a **separate process** that uses the **stdio**
transport:

- It starts the existing `AppModule` with `NestFactory.createApplicationContext()`
  — the same config, MongoDB connection setup and services as the API, but **no
  HTTP server** and no extra port.
- **stdout carries only MCP protocol messages.** All logs go to **stderr**.
- It uses the existing `.env` (no extra environment variables) and loads it from
  `agilix-backend/` even when an MCP client starts it from another folder.
- It is **read-only**: tools that change data are refused while
  `MCP_WRITE_TOOLS_ENABLED` is `false` (`src/mcp/mcp-server.constants.ts`),
  because AgiliX has no authentication yet.

### Run and test

```bash
npm run build        # compiles the API and the MCP server (dist/mcp/mcp-main.js)
npm run mcp:test     # automated smoke test (needs MongoDB running and .env configured)
npm run mcp:inspect  # opens MCP Inspector in the browser to try the tools by hand
npm run mcp          # starts the server on stdio (normally started BY an MCP client)
```

`npm run mcp` waits silently for MCP messages on stdin; stop it with `Ctrl+C`.
Rebuild (`npm run build`) after every change — the MCP server runs from `dist/`.

### Built-in tool

| Tool | Type | Purpose |
|---|---|---|
| `agilix_server_info` | read-only | Health check: server name/version, NestJS context status, MongoDB connection state |

### Connect from Claude Desktop (Windows example)

Add to `%APPDATA%\Claude\claude_desktop_config.json` (use your real path and
double backslashes), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "agilix": {
      "command": "node",
      "args": ["C:\\path\\to\\AgiliX\\agilix-backend\\dist\\mcp\\mcp-main.js"]
    }
  }
}
```

### Adding a tool (for the MCP tools owner)

1. Create `src/mcp/tools/<name>.tool.ts`:

```ts
   import { z } from 'zod';
   import { ProjectsService } from '../../projects/projects.service';
   import { defineMcpTool } from '../mcp-tool.types';

   export const getProjectTool = defineMcpTool({
     name: 'get_project',
     title: 'Get project',
     description: 'Returns one AgiliX project by id.',
     inputSchema: { projectId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid project id') },
     readOnly: true,
     handler: ({ projectId }, ctx) => ctx.get(ProjectsService).findOne(projectId),
   });
```

2. Add it to `MCP_TOOLS` in `src/mcp/tools/index.ts`.
3. `npm run build`, then `npm run mcp:test` / `npm run mcp:inspect`.

Rules:

- Call existing services through `ctx.get(SomeService)` — never duplicate business logic.
- Return plain data; throw normal Nest exceptions (`NotFoundException`, …). The
  factory converts results and errors to MCP responses.
- Validate input with the zod `inputSchema`. To reuse an existing DTO's rules, call
  `validateDto(SomeDto, args)` from `src/mcp/mcp-validation.ts` (the HTTP
  `ValidationPipe` does not run in the MCP process).
- Never write to stdout (use Nest `Logger`); stdout belongs to the MCP protocol.
- Only `readOnly: true` tools are allowed until the team explicitly enables write tools.

Files you normally do **not** need to change: `mcp-main.ts`, `mcp-process-setup.ts`,
`mcp-server.factory.ts`, `mcp-results.ts`, `mcp-validation.ts`, `stderr-logger.ts`.