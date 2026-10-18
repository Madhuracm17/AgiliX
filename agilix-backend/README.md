# Agilix Backend

NestJS + MongoDB backend for Agilix. Phase 1: core CRUD + Kanban/backlog/sprint
plumbing + the AI sprint-risk centerpiece.

## Structure

```text
src/
  users/        User accounts + roles (admin/manager/developer)
  projects/     Projects, ownership, members
  tasks/        Kanban tasks — status, priority, backlog vs sprint assignment
  sprints/      Sprint creation + date range + team velocity
  ai/           AI sprint-risk prediction (OpenRouter API call, structured JSON out)
```

## Setup

```bash
cp .env.example .env      # fill in MONGODB_URI and OPENROUTER_API_KEY
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
6. Get the AI risk verdict (`GET /ai/sprint-risk/:sprintId`) — calls OpenRouter with
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
- It uses the existing `.env` and loads it from `agilix-backend/` even when an
  MCP client starts it from another folder.
- **It acts as one real AgiliX account**, set by `MCP_USER_EMAIL` in `.env`.
  Every business tool runs the same checks as the HTTP routes (`AccessService`
  for project/sprint/task membership, `requireRole` for manager-only reports),
  so an MCP client sees exactly what that person sees in the web app. The
  account is re-read on every call, so a role change applies immediately.
  Without `MCP_USER_EMAIL`, only `agilix_server_info` works; the other tools
  return `Error 401`.
- It is **read-only**: tools that change data are refused while
  `MCP_WRITE_TOOLS_ENABLED` is `false` (`src/mcp/mcp-server.constants.ts`).

### Run and test

```bash
npm run build        # compiles the API and the MCP server (dist/mcp/mcp-main.js)
npm run mcp:test     # automated smoke test (needs MongoDB running and .env configured)
npm run mcp:inspect  # opens MCP Inspector in the browser to try the tools by hand
npm run mcp          # starts the server on stdio (normally started BY an MCP client)
```

`npm run mcp` waits silently for MCP messages on stdin; stop it with `Ctrl+C`.
Rebuild (`npm run build`) after every change — the MCP server runs from `dist/`.

### Tools

All tools are read-only. "Team reports" tools need a manager or admin account,
exactly like the Reports pages.

| Tool | Who | Purpose |
|---|---|---|
| `agilix_server_info` | anyone (no account needed) | Health check: server version, NestJS context, MongoDB state, which account the tools act as |
| `agilix_whoami` | any account | The account the tools act as (name, email, role) |
| `agilix_list_projects` | any account | Projects this account can see |
| `agilix_get_project` | project member | One project with owner, members, status and WIP limit |
| `agilix_list_tasks` | project member | Tasks, filtered by status, assignee or backlog only |
| `agilix_get_task_time` | project member | Total time and time entries for one task |
| `agilix_list_sprints` | project member | Sprints with goal, dates, status and points |
| `agilix_get_sprint` | project member | One sprint with stats, days remaining and its tasks |
| `agilix_get_project_summary` | manager / admin | Task counts, story points, hours, active-sprint pace |
| `agilix_get_team_workload` | manager / admin | Tasks, completion and hours per team member |
| `agilix_get_velocity` | manager / admin | Committed vs completed points per sprint, average velocity |
| `agilix_get_burndown` | manager / admin | Burndown / burnup series for a sprint |
| `agilix_get_sprint_report` | manager / admin | Sprint report: points, scope changes, finished and unfinished tasks |
| `agilix_get_kanban_report` | manager / admin | Cumulative flow, throughput, cycle and lead time (14/30/90 days) |
| `agilix_get_my_report` | manager / developer / tester | The account's own tasks, progress and time |
| `agilix_predict_sprint_risk` | project member | AI: green / yellow / red risk, reasoning, completion forecast for a planned or active sprint |
| `agilix_estimate_story_points` | project member | AI: story-point estimate (0–13) with reasoning for a task idea or existing task |
| `agilix_recommend_priority` | project member | AI: low / medium / high with reasoning (ignores the current priority) |
| `agilix_suggest_tasks` | project member | AI: missing tasks for the backlog, with priority and reasoning |
| `agilix_get_kanban_insights` | project member | AI: Kanban board health, bottlenecks and recommendations |
| `agilix_get_github_activity` | manager / admin | GitHub activity per member from the project's linked repo, read **through GitHub's MCP server** |
| `agilix_predict_burnout_risk` | manager / admin | AI: burnout risk per member (low / medium / high, score, reasons, recommendations) with the measured signals |
| `agilix_get_sprint_health` | manager / admin | AI: sprint health (active sprint) or flow health (Kanban), with forecast, risks and recommendations |

The AI tools call OpenRouter (`OPENROUTER_API_KEY`), can take up to ~30 s, and
only suggest: nothing is created or saved. `Error 503` means every model failed.
`npm run mcp:test` checks that they are registered but does not call them.

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

1. Add the tool to the matching file in `src/mcp/tools/` (`project.tools.ts`,
   `task.tools.ts`, `sprint.tools.ts`, `report.tools.ts`), for example:

```ts
export const listSprintsTool = defineMcpTool({
  name: 'agilix_list_sprints',
  title: 'List sprints',
  description: 'Lists the sprints of a Scrum project ...',
  readOnly: true,
  inputSchema: { projectId: objectId('project') },
  handler: async ({ projectId }, ctx) => {
    const { user, access } = await actingUser(ctx);   // the MCP_USER_EMAIL account
    await access.assertProject(user, projectId);      // same check as the HTTP route
    return (await ctx.get(SprintsService).findAllForProject(projectId)).map(slimSprint);
  },
});
```

2. Add it to `MCP_TOOLS` in `src/mcp/tools/index.ts`.
3. `npm run build`, then `npm run mcp:test` / `npm run mcp:inspect`.

Rules:

- Always resolve the account with `actingUser(ctx)` and run the **same**
  `AccessService` / `requireRole` checks as the matching HTTP controller before
  calling a service. Never skip them: the MCP process has full database access.
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
## AI team insights (AgiliX as an MCP client)

AgiliX also **uses** other MCP servers. `src/integrations/github/github-mcp.client.ts`
connects to GitHub's remote MCP server (`https://api.githubcopilot.com/mcp/`,
read-only, `repos` + `pull_requests` toolsets) with `GITHUB_MCP_TOKEN`, and reads
the repository linked to each project (**Edit project → GitHub repository**).
People are matched to commits by the **GitHub username** on the Team page or in
the profile menu.

`src/insights/` turns the data into AI insights:

1. `TeamContextService` builds the context payload for a project: per member,
   tracked hours (late-night 22:00–06:00 and weekend hours in `TEAM_TIMEZONE`),
   longest day, consecutive working days, open / ageing / finished tasks, and
   GitHub commits, PRs and reviews. Calendar meetings will be added here.
2. `BurnoutRiskService` and `SprintHealthService` send those **calculated**
   numbers to the LLM (`LlmService`, OpenRouter) and validate the JSON answer
   (levels, score ranges, one entry per member). The numbers are returned with
   the verdict as evidence.

| Route (managers and admins) | Purpose |
|---|---|
| `GET /integrations/github/status` | Is GitHub connected? Lists GitHub's MCP tools |
| `GET /integrations/github/:projectId/activity?days=14` | GitHub activity per member |
| `GET /insights/:projectId/context?days=14` | The raw context payload (no AI call) |
| `GET /insights/:projectId/burnout?days=14&refresh=1` | AI burnout risk per member |
| `GET /insights/:projectId/sprint-health?refresh=1` | AI sprint / flow health |

Results are cached for 10 minutes; `refresh=1` runs the analysis again. In the
web app: **AI Insights → AI Team Health**.

### Demo data

`npm run seed:demo` creates a separate Scrum project **"AgiliX Demo"** (active
Sprint 3, two finished sprints, 19 tasks, two weeks of tracked time, linked to
the AgiliX GitHub repo) owned by the manager in `MCP_USER_EMAIL`. Its three demo
users (`jovika@demo.agilix.local`, `punya@…`, `madhura@…`, password `Demo@1234`)
have deliberately different work patterns, so burnout risk and sprint health
have something to find. It never changes real projects or users.
`npm run seed:demo -- --remove` deletes everything it created.
