import { ForbiddenException } from '@nestjs/common';
import { AccessService } from '../../src/auth/access.service';
import { ActivityService } from '../../src/collaboration/activity.service';
import { registerAgilixPrompts, registerAgilixResources } from '../../src/mcp/mcp-content.register';
import type { McpIdentity } from '../../src/mcp/mcp-identity';
import type { McpToolContext } from '../../src/mcp/mcp-tool.types';
import { MCP_PROMPTS, planSprintPrompt, triageBacklogPrompt } from '../../src/mcp/prompts/agilix.prompts';
import {
  boardResource,
  MCP_RESOURCES,
  projectOverviewResource,
  workflowGuideResource,
} from '../../src/mcp/resources/agilix.resources';
import { MCP_TOOLS } from '../../src/mcp/tools';
import { MCP_WRITE_TOOLS } from '../../src/mcp/tools/write.tools';
import { ProjectsService } from '../../src/projects/projects.service';
import { SprintsService } from '../../src/sprints/sprints.service';
import { TasksService } from '../../src/tasks/tasks.service';
import { UserRole } from '../../src/users/schemas/user.schema';

const P = '64b7f0c2a1b2c3d4e5f60701';
const S1 = '64b7f0c2a1b2c3d4e5f60711';
const S2 = '64b7f0c2a1b2c3d4e5f60712';
const ME = '64b7f0c2a1b2c3d4e5f60704';

const me: McpIdentity = { userId: ME, role: UserRole.MANAGER, name: 'Lekha', email: 'lekha@example.com' };

const task = (id: string, status: string, sprint: string | null, extra: Record<string, unknown> = {}) => ({
  _id: id,
  title: `Task ${id}`,
  status,
  priority: 'medium',
  storyPoints: 3,
  sprint,
  ...extra,
});

/** A fake AgiliX: one Scrum project with an active sprint (S1) and a planned one (S2). */
function context(options: { methodology?: string; denyProject?: boolean } = {}): McpToolContext {
  const project = { _id: P, name: 'AgiliX', methodology: options.methodology ?? 'scrum', owner: ME, members: [] };
  const tasks = [
    task('t1', 'todo', S1),
    task('t2', 'in_progress', S1),
    task('t3', 'review', S1),
    task('t4', 'todo', null, { storyPoints: 0 }),
    task('t5', 'todo', S2),
  ];
  const fakes = new Map<unknown, unknown>([
    [
      AccessService,
      {
        assertProject: async () => {
          if (options.denyProject) throw new ForbiddenException('You do not have access to this project.');
        },
      },
    ],
    [
      ProjectsService,
      { findAll: async () => [project], findOne: async () => project, withPeople: async (x: unknown) => x },
    ],
    [
      TasksService,
      {
        findAllForProject: async () => tasks,
        findBacklog: async () => tasks.filter((t) => !t.sprint),
      },
    ],
    [
      SprintsService,
      {
        findAllForProject: async () => [
          { _id: S1, name: 'Sprint 3', status: 'active' },
          { _id: S2, name: 'Sprint 4', status: 'planned' },
        ],
      },
    ],
    [ActivityService, { forProject: async () => [{ id: 'a1', text: 'moved “Task t2” from To Do to In Progress' }] }],
  ]);
  return {
    user: async () => me,
    get: ((token: unknown) => {
      if (!fakes.has(token)) throw new Error(`no fake for ${String(token)}`);
      return fakes.get(token);
    }) as McpToolContext['get'],
  };
}

describe('MCP resource and prompt registry', () => {
  it('has unique names and addresses', () => {
    const names = MCP_RESOURCES.map((r) => r.name);
    const uris = MCP_RESOURCES.map((r) => r.uri ?? r.uriTemplate);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(uris).size).toBe(uris.length);
    expect(MCP_RESOURCES.every((r) => (r.uri ? !r.uriTemplate : !!r.uriTemplate))).toBe(true);
    expect(MCP_RESOURCES.every((r) => (r.uri ?? r.uriTemplate ?? '').startsWith('agilix://'))).toBe(true);
    const prompts = MCP_PROMPTS.map((p) => p.name);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('prompts only mention tools that exist', async () => {
    const known = new Set([...MCP_TOOLS, ...MCP_WRITE_TOOLS].map((t) => t.name));
    const fakeCtx = context();
    for (const prompt of MCP_PROMPTS) {
      const messages = await prompt.build({ projectId: P, sprintId: S1, taskId: 't1' }, {
        ...fakeCtx,
        // Prompts that embed data are covered separately; here only their text matters.
        get: ((token: unknown) => fakeCtx.get(token as never)) as McpToolContext['get'],
      }).catch(() => [] as Awaited<ReturnType<typeof prompt.build>>);
      const text = messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
      for (const mention of text.match(/agilix_[a-z_]+/g) ?? []) {
        expect(known.has(mention)).toBe(true);
      }
    }
  });
});

describe('resources', () => {
  it('the workflow guide explains roles, columns and approvals', async () => {
    const guide = (await workflowGuideResource.read({}, context())) as string;
    expect(guide).toContain('## Roles');
    expect(guide).toContain('To Do → In Progress → Review → Done');
    expect(guide).toContain('approval');
  });

  it('project overview counts tasks per column and lists the active sprint', async () => {
    const overview = (await projectOverviewResource.read({ projectId: P }, context())) as {
      activeSprint: { id: string } | null;
      plannedSprints: Array<{ id: string }>;
      tasks: { total: number; byColumn: Record<string, number>; inBacklog: number };
      recentActivity: unknown[];
    };
    expect(overview.activeSprint?.id).toBe(S1);
    expect(overview.plannedSprints.map((s) => s.id)).toEqual([S2]);
    expect(overview.tasks.total).toBe(5);
    expect(overview.tasks.byColumn).toEqual({ todo: 3, in_progress: 1, review: 1, done: 0 });
    expect(overview.tasks.inBacklog).toBe(1);
    expect(overview.recentActivity).toHaveLength(1);
  });

  it('Scrum board shows only the active sprint; Kanban shows everything', async () => {
    const scrum = (await boardResource.read({ projectId: P }, context())) as { columns: Record<string, Array<{ id: string }>> };
    expect(Object.values(scrum.columns).flat().map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);

    const kanban = (await boardResource.read({ projectId: P }, context({ methodology: 'kanban' }))) as {
      columns: Record<string, unknown[]>;
    };
    expect(Object.values(kanban.columns).flat()).toHaveLength(5);
  });

  it('refuses a project the account is not on, like the tools', async () => {
    await expect(projectOverviewResource.read({ projectId: P }, context({ denyProject: true }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('registration', () => {
  it('registers every resource and turns errors into safe messages', async () => {
    const registered: Array<{ name: string; read: (...args: unknown[]) => Promise<unknown> }> = [];
    const server = {
      registerResource: (name: string, _uri: unknown, _meta: unknown, read: (...args: unknown[]) => Promise<unknown>) => {
        registered.push({ name, read });
      },
    };
    registerAgilixResources(server as never, context({ denyProject: true }));
    expect(registered.map((r) => r.name)).toEqual(MCP_RESOURCES.map((r) => r.name));

    const overview = registered.find((r) => r.name === projectOverviewResource.name)!;
    await expect(overview.read(new URL(`agilix://projects/${P}`), { projectId: P }, {})).rejects.toThrow(
      'Error 403: You do not have access to this project.',
    );

    const guide = registered.find((r) => r.name === workflowGuideResource.name)!;
    const result = (await guide.read(new URL('agilix://guide/workflow'), {})) as {
      contents: Array<{ uri: string; mimeType: string; text: string }>;
    };
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('# How AgiliX works');
  });

  it('registers every prompt with its arguments', () => {
    const registered: Array<{ name: string; config: { argsSchema: Record<string, unknown> } }> = [];
    const server = {
      registerPrompt: (name: string, config: { argsSchema: Record<string, unknown> }) => {
        registered.push({ name, config });
      },
    };
    registerAgilixPrompts(server as never, context());
    expect(registered.map((p) => p.name)).toEqual(MCP_PROMPTS.map((p) => p.name));
    expect(Object.keys(registered.find((p) => p.name === 'plan_sprint')!.config.argsSchema)).toEqual([
      'projectId',
      'sprintDays',
    ]);
  });
});

describe('prompts', () => {
  it('plan_sprint embeds the live project overview, then the instructions', async () => {
    const messages = await planSprintPrompt.build({ projectId: P }, context());
    expect(messages[0].content.type).toBe('resource');
    if (messages[0].content.type === 'resource') {
      expect(messages[0].content.resource.uri).toBe(`agilix://projects/${P}`);
      expect(JSON.parse(messages[0].content.resource.text).activeSprint.id).toBe(S1);
    }
    expect(messages[1].content.type === 'text' && messages[1].content.text).toContain('14-day sprint');
  });

  it('triage_backlog never asks the assistant to change data on its own', async () => {
    const [message] = await triageBacklogPrompt.build({ projectId: P }, context());
    const text = message.content.type === 'text' ? message.content.text : '';
    expect(text).toContain('do not change anything');
    expect(text).toContain('Do not change any data unless I explicitly confirm');
  });
});
