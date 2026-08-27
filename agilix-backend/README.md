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
