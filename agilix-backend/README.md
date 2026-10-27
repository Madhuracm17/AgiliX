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

The tools in this table are read-only. "Team reports" tools need a manager or admin
account, exactly like the Reports pages. Write tools are listed further down.

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
| `agilix_get_meeting_load` | manager / admin | Meeting load per member from their connected **Google Calendars** (times only), incl. the next 7 days |
| `agilix_list_comments` | project member | Comments on a task |
| `agilix_get_activity` | project member | The project's activity log, or one task's history |
| `agilix_predict_burnout_risk` | manager / admin | AI: burnout risk per member (low / medium / high, score, reasons, recommendations) with the measured signals |
| `agilix_get_sprint_health` | manager / admin | AI: sprint health (active sprint) or flow health (Kanban), with forecast, risks and recommendations |
| `agilix_get_standup_summary` | project member | AI: daily standup per person (yesterday / today / blockers) from task moves and commit messages |

The AI tools call OpenRouter (`OPENROUTER_API_KEY`), can take up to ~30 s, and
only suggest: nothing is created or saved. `Error 503` means every model failed.
`npm run mcp:test` checks that they are registered but does not call them.

### Resources and prompts

Besides tools, the server offers **resources** (read-only data a client can attach
as context) and **prompts** (ready-made workflows). They act as the same
`MCP_USER_EMAIL` account and are built from the read tools, so they follow the
same permissions (`src/mcp/resources/`, `src/mcp/prompts/`).

| Resource | Content |
|---|---|
| `agilix://guide/workflow` | How AgiliX works: roles, columns, approvals, what the insights measure (markdown) |
| `agilix://projects` | Projects this account can see |
| `agilix://projects/{projectId}` | Overview: team, active sprint, tasks per column, recent activity |
| `agilix://projects/{projectId}/board` | The board by column (Scrum: active sprint; Kanban: all tasks) |
| `agilix://projects/{projectId}/backlog` | Open backlog tasks, with how many are unestimated |
| `agilix://projects/{projectId}/activity` | 50 most recent activity entries |
| `agilix://tasks/{taskId}` | One task with comments, history and tracked hours |

| Prompt | Arguments | What the assistant does |
|---|---|---|
| `plan_sprint` | projectId, sprintDays? | Sprint goal and tasks that fit velocity and calendar availability (embeds the live overview) |
| `daily_standup` | projectId | Standup message per person plus what needs attention |
| `sprint_retrospective` | sprintId | Went well / didn't / actions, from the sprint report, burndown, activity and comments |
| `team_health_check` | projectId | Burnout risk, delivery health and meeting load with actions (managers) |
| `triage_backlog` | projectId | Suggested points and priorities, vague tasks, missing work; changes nothing |
| `explain_task` | taskId | Catch-up on one task (embeds the task with its comments and history) |

In Claude Desktop, prompts appear under the **+** (attach) menu → AgiliX, and
resources can be attached the same way. In MCP Inspector, use the Resources and
Prompts tabs.

### Write tools (off by default)

`src/mcp/tools/write.tools.ts` has tools that change data:

| Tool | Who (same rules as the web app) |
|---|---|
| `agilix_create_task` | managers create; developers / testers get an **approval request** instead |
| `agilix_update_task` | title, description, priority, assignee: managers; story points: assignee or manager |
| `agilix_move_task` | sprint step rules, Review → Done only by tester / manager, WIP limit, comment when sending back |
| `agilix_add_task_to_sprint` | managers any task; others only unassigned or their own |
| `agilix_create_sprint`, `agilix_start_sprint`, `agilix_complete_sprint` | managers |
| `agilix_add_comment` | anyone on the team except admins |

They call the **same controller methods as the HTTP routes** (`TasksController`,
`SprintsController`) with the MCP account, after validating the arguments with the
same DTOs, so they can never do more than that account can do in the web app.
Nothing can be deleted through MCP, every call is logged on stderr, and every change
appears in the project's activity log like a change made in the web app.

They are only registered when `MCP_WRITE_TOOLS_ENABLED` in
`src/mcp/mcp-server.constants.ts` is `true` (a team decision; it is `false` now).

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
   GitHub commits, PRs and reviews, and meeting load from Google Calendar.
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
| `GET /insights/:projectId/standup?refresh=1` | AI daily standup (any project member) |

Results are cached for 10 minutes; `refresh=1` runs the analysis again. In the
web app: **AI Insights → AI Team Health**.

### Google Calendar

Each person connects **their own** calendar: profile menu → **Google Calendar →
Connect**. AgiliX asks Google for read-only access to events
(`calendar.events.readonly`) and reads only meeting **times**, never titles,
descriptions or attendees. Per person it measures meeting hours, average per
working day, heaviest day, back-to-back meetings, days with 4+ meetings,
late-night and weekend meetings, out-of-office days, and what is booked for the
next 7 days. Burnout risk and sprint health use these numbers; declined,
cancelled, "free" and all-day events are ignored and overlapping meetings are
counted once (`src/integrations/google-calendar/calendar-load.ts`).

Security: the Google refresh token is stored **encrypted** (AES-256-GCM, key from
`CALENDAR_TOKEN_KEY` or `JWT_SECRET`) in its own `calendarconnections`
collection, and the OAuth `state` is signed and expires after 10 minutes, so a
forged callback cannot attach a calendar to someone else's account.

Setup (once, in Google Cloud Console):
1. Create a project and enable **Google Calendar API**.
2. **OAuth consent screen**: External, add the scope
   `.../auth/calendar.events.readonly`, and add every tester's Google account
   under **Test users** (while the app is in "Testing", only they can connect,
   and Google expires the connection after 7 days; reconnecting fixes it).
3. **Credentials → Create OAuth client ID → Web application**, with the
   redirect URI `http://localhost:3000/integrations/google-calendar/callback`.
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` (see `.env.example`), and restart the backend.

| Route | Who | Purpose |
|---|---|---|
| `GET /integrations/google-calendar/me` | anyone | Is my calendar connected? |
| `POST /integrations/google-calendar/connect` | anyone | Google consent page address |
| `DELETE /integrations/google-calendar/me` | anyone | Disconnect (and revoke at Google) |
| `GET /integrations/google-calendar/callback` | Google (public, signed state) | Saves the connection |
| `GET /integrations/google-calendar/:projectId/load?days=14` | manager / admin | Team meeting load |

### Demo data

`npm run seed:demo` creates a separate Scrum project **"AgiliX Demo"** (active
Sprint 3, two finished sprints, 19 tasks, two weeks of tracked time, linked to
the AgiliX GitHub repo) owned by the manager in `MCP_USER_EMAIL`. Its three demo
users (`jovika@demo.agilix.local`, `punya@…`, `madhura@…`, password `Demo@1234`)
have deliberately different work patterns, so burnout risk and sprint health
have something to find. It never changes real projects or users.
`npm run seed:demo -- --remove` deletes everything it created.

## Comments and activity log

**Comments:** every card on the Scrum and Kanban boards has a **Comment** button
showing how many comments the task has. It opens a side panel with the comments
and the task's **History**. Anyone on the team can comment (admins can read);
authors delete their own comments, managers and admins any. The assignee and
everyone already in the conversation get a notification in the bell that opens
the same panel. A deleted task's comments are deleted with it.

**Activity log:** side menu → **Activity** shows who did what in the project, by
day, with filters (tasks, sprints, comments, team and approvals). It records
tasks created / moved / sent back / assigned / edited / added to or taken out of
a sprint / deleted (and approval requests), sprints created / edited / started /
completed, approvals, team changes, and comments. Entries are kept for 180 days.

How it is recorded: `ActivityInterceptor` (`src/collaboration/`) watches the
routes listed in `activity-events.ts` and, after a call **succeeds**, writes what
happened, so the task, sprint, approval and team code did not need to change.
Refused calls (403, 400) are not logged. The wording rules are pure functions,
unit tested in `test/collaboration/`.

| Route | Who | Purpose |
|---|---|---|
| `GET /comments/task/:taskId` | project member | Comments, oldest first |
| `POST /comments/task/:taskId` `{ text }` | project member (not admin) | Add a comment (max 2000 characters) |
| `DELETE /comments/:id` | author, manager, admin | Delete a comment |
| `GET /comments/counts?tasks=id1,id2` | project member | Comment counts for a board, in one request |
| `GET /activity/project/:projectId?limit=50&before=<date>` | project member, admin | Activity log, newest first |
| `GET /activity/task/:taskId` | project member, admin | One task's history |

## Tests

```bash
npm test                    # everything
npm run test:ai             # AI features (OpenRouter is mocked)
npm run test:integrations   # Google Calendar meeting load, token encryption, OAuth state
npm run test:collaboration  # activity log wording rules
npm run test:mcp            # MCP registry, write tools, meeting-load tool permissions
```

## Docker and CI

From the repository root, `docker compose up --build` runs the backend
(`http://localhost:3000`, reads `agilix-backend/.env`) and the web app
(`http://localhost:5173`). `docker compose --profile local-db up --build` also
starts a local MongoDB (then set `MONGODB_URI=mongodb://mongo:27017/agilix`).

GitHub Actions (`.github/workflows/ci.yml`) builds both apps, runs the backend
tests and builds both Docker images on every push to `main` and every pull request.
