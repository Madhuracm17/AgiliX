import { z } from 'zod';
import type { McpToolContext } from '../mcp-tool.types';
import { projectOverviewResource, taskResource } from '../resources/agilix.resources';

/*
 * MCP PROMPTS: ready-made workflows a user can pick in an MCP client
 * ("Plan the next sprint", "Run a retrospective"...). Each prompt returns the
 * instructions for the assistant, which tools and resources to use, and the
 * rules to follow, and some embed live data (read with the same access checks
 * as the tools) so the assistant starts from the real state of the project.
 *
 * MCP prompt arguments are always strings.
 */

export type PromptMessage =
  | { role: 'user' | 'assistant'; content: { type: 'text'; text: string } }
  | {
      role: 'user' | 'assistant';
      content: { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };
    };

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodType>;
  build: (args: Record<string, string | undefined>, ctx: McpToolContext) => Promise<PromptMessage[]>;
}

const projectArg = z.string().trim().min(1).describe('Project id (from the agilix://projects resource or agilix_list_projects).');

const text = (value: string): PromptMessage => ({ role: 'user', content: { type: 'text', text: value } });

/** Live data attached to the prompt, so the assistant starts from the real state. */
async function embed(
  uri: string,
  read: () => Promise<unknown>,
): Promise<PromptMessage> {
  return {
    role: 'user',
    content: { type: 'resource', resource: { uri, mimeType: 'application/json', text: JSON.stringify(await read(), null, 2) } },
  };
}

const GROUNDING =
  'Rules: base everything on AgiliX data from the tools and resources, quote the actual numbers, and say ' +
  'when data is missing instead of guessing. Follow the process in agilix://guide/workflow. Do not change ' +
  'any data unless I explicitly confirm a specific change.';

export const planSprintPrompt: McpPromptDefinition = {
  name: 'plan_sprint',
  title: 'Plan the next sprint',
  description:
    'Proposes a sprint goal and a set of backlog tasks that fits the team\'s velocity and availability ' +
    '(meetings and out-of-office days from Google Calendar).',
  args: {
    projectId: projectArg,
    sprintDays: z.string().optional().describe('Sprint length in days (default 14).'),
  },
  build: async ({ projectId = '', sprintDays }, ctx) => [
    await embed(`agilix://projects/${projectId}`, () => projectOverviewResource.read({ projectId }, ctx)),
    text(
      [
        `Help me plan the next ${sprintDays || '14'}-day sprint for this project (overview attached).`,
        '',
        'Steps:',
        `1. Read agilix://projects/${projectId}/backlog for the candidate tasks.`,
        '2. Call agilix_get_velocity for the recent velocity (story points per sprint).',
        '3. Call agilix_get_meeting_load (next 7 days) and agilix_get_team_workload to judge who has capacity.',
        '4. Use agilix_estimate_story_points or agilix_recommend_priority for important tasks that lack them.',
        '',
        'Then give me:',
        '- a one-sentence sprint goal,',
        '- a table of the proposed tasks (title, priority, story points, suggested assignee, why),',
        '- the total points vs the average velocity, and what you left out and why,',
        '- risks (unestimated work, people with heavy meetings or time off).',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

export const dailyStandupPrompt: McpPromptDefinition = {
  name: 'daily_standup',
  title: 'Daily standup',
  description: 'A short standup for the team: what each person did, will do, and what blocks them.',
  args: { projectId: projectArg },
  build: async ({ projectId = '' }) => [
    text(
      [
        `Run today's standup for project ${projectId}.`,
        '',
        '1. Call agilix_get_standup_summary for this project.',
        `2. Read agilix://projects/${projectId}/board for what is in progress or waiting in Review.`,
        '',
        'Write it as a message I can paste into the team chat: one short block per person ' +
          '(Yesterday / Today / Blockers), then a "Needs attention" list (tasks stuck in progress for more ' +
          'than 3 days, work waiting in Review, unassigned tasks).',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

export const retrospectivePrompt: McpPromptDefinition = {
  name: 'sprint_retrospective',
  title: 'Sprint retrospective',
  description: 'Prepares a retrospective for a sprint: what went well, what did not, and concrete actions.',
  args: { sprintId: z.string().trim().min(1).describe('Sprint id (from agilix_list_sprints).') },
  build: async ({ sprintId = '' }) => [
    text(
      [
        `Prepare a retrospective for sprint ${sprintId}.`,
        '',
        'Use: agilix_get_sprint_report (committed vs completed, scope changes, unfinished work), ' +
          'agilix_get_burndown (how the work flowed), agilix_get_sprint (tasks), and agilix_get_activity ' +
          'for the project (tasks sent back from Review, late scope changes). Read the comments of tasks ' +
          'that were sent back or left unfinished (agilix_list_comments).',
        '',
        'Give me: a 3-sentence summary with the numbers; What went well; What did not go well; ' +
          '3 specific, doable actions for the next sprint; and questions to ask the team.',
        'Talk about the process and the work, never blame individuals.',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

export const teamHealthPrompt: McpPromptDefinition = {
  name: 'team_health_check',
  title: 'Team health check',
  description: 'Burnout risk and delivery health for the team, with kind, practical actions for the manager.',
  args: { projectId: projectArg },
  build: async ({ projectId = '' }) => [
    text(
      [
        `Do a team health check for project ${projectId}. (Manager or admin account needed.)`,
        '',
        '1. agilix_get_sprint_health: is delivery on track?',
        '2. agilix_predict_burnout_risk (14 days): who shows signs of strain, and why?',
        '3. agilix_get_meeting_load: is anyone overloaded with meetings or away soon?',
        '',
        'Give me: the overall picture in 3 sentences; a table per person (risk, the key numbers, one ' +
          'action); and the top 3 things I should do this week. Be kind and specific. This is about work ' +
          'patterns, not health: never diagnose anyone, and treat missing data as unknown.',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

export const triageBacklogPrompt: McpPromptDefinition = {
  name: 'triage_backlog',
  title: 'Triage the backlog',
  description: 'Finds unestimated, unprioritised or unclear backlog tasks and suggests fixes (nothing is changed).',
  args: { projectId: projectArg },
  build: async ({ projectId = '' }) => [
    text(
      [
        `Triage the backlog of project ${projectId}.`,
        '',
        `1. Read agilix://projects/${projectId}/backlog.`,
        '2. For tasks with no story points or a doubtful priority, call agilix_estimate_story_points and ' +
          'agilix_recommend_priority with the task\'s title, description and taskId.',
        '3. Call agilix_suggest_tasks for important work that seems to be missing.',
        '',
        'Give me a table: task, current points / priority, suggested points / priority, short reason. ' +
          'Then list tasks whose title or description is too vague to estimate, and the suggested new tasks.',
        'These are SUGGESTIONS: do not change anything; I will decide.',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

export const explainTaskPrompt: McpPromptDefinition = {
  name: 'explain_task',
  title: 'Catch me up on a task',
  description: 'Summarises one task: where it stands, what was discussed in the comments, and the next step.',
  args: { taskId: z.string().trim().min(1).describe('Task id.') },
  build: async ({ taskId = '' }, ctx) => [
    await embed(`agilix://tasks/${taskId}`, () => taskResource.read({ taskId }, ctx)),
    text(
      [
        'Catch me up on this task (attached with its comments and history).',
        'Tell me: what it is, where it stands now and who has it, the key points and decisions from the ' +
          'comments, anything blocking it (for example sent back from Review, and why), and the most useful ' +
          'next step. Keep it under 150 words.',
        '',
        GROUNDING,
      ].join('\n'),
    ),
  ],
};

/** Every prompt the AgiliX MCP server offers. */
export const MCP_PROMPTS: McpPromptDefinition[] = [
  planSprintPrompt,
  dailyStandupPrompt,
  retrospectivePrompt,
  teamHealthPrompt,
  triageBacklogPrompt,
  explainTaskPrompt,
];
