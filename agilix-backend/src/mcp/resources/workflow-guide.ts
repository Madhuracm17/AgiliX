/** The agilix://guide/workflow resource: how AgiliX works, for an AI assistant. */
export const WORKFLOW_GUIDE = `# How AgiliX works

AgiliX is an Agile project management app for Scrum and Kanban teams. This MCP
server acts as ONE AgiliX account (see \`agilix_whoami\`) and sees exactly what
that account sees in the web app.

## Roles
- **Admin**: oversees projects, people and reports. Does not create or move tasks.
- **Manager**: plans the work. Creates and runs sprints, creates and edits tasks,
  sets priority and assignee, approves requests from the team.
- **Developer**: does the work. Moves their tasks, tracks time, estimates their own tasks.
- **Tester**: reviews work. Only testers, managers and admins can move a task from
  Review to Done, or send it back to In Progress (with a comment).

## Task columns
To Do → In Progress → Review → Done

- **Scrum sprint tasks** move one step at a time (no skipping columns).
- Sending a task back from Review to In Progress needs a comment for the developer.
- **Kanban** boards may have a WIP limit on In Progress; the server refuses moves above it.

## Tasks
- Fields: title, description, type (frontend, backend, database, feature, bug,
  security...), priority (low / medium / high), story points (0, 1, 2, 3, 5, 8, 13),
  assignee, sprint.
- Developers and testers cannot create or delete tasks directly: their request
  goes to a manager for **approval**.
- Title, description, priority and assignee: managers. Story points: the assignee or a manager.

## Scrum sprints
planned → active → completed. Only one active sprint per project. Completing a
sprint records committed vs completed story points (velocity) and moves
unfinished tasks to a planned sprint or back to the backlog.

## Collaboration
- Every task has **comments**; the assignee and earlier commenters are notified.
- The **activity log** records who created, moved, assigned, edited or deleted
  tasks, sprint changes, approvals, team changes and comments.

## Data behind the AI insights
Numbers are measured in code; the AI only interprets them.
- **AgiliX**: tasks, story points, sprints, tracked time (late-night 22:00–06:00
  and weekend hours in the team's time zone), consecutive working days.
- **GitHub** (through GitHub's MCP server): commits, pull requests, reviews per person.
- **Google Calendar** (people who connected it): meeting hours, back-to-back
  meetings, out-of-office days. Meeting TIMES only, never titles.
- Burnout risk describes WORK-PATTERN risk, not anyone's health. Missing data
  means "unknown", not "fine".

## Good practice for an assistant
- Use the read tools and resources to ground every suggestion in real data, and
  quote the numbers.
- AI estimate / priority / suggestion tools only SUGGEST; nothing is saved.
- Before using a tool that changes data (if enabled), state exactly what will
  change and ask the user to confirm.
`;
