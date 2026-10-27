import {
  describeEvents,
  EventFacts,
  quote,
  sprintLabel,
  taskLink,
  TaskSnapshot,
} from '../../src/collaboration/activity-events';

const P = '64b7f0c2a1b2c3d4e5f60701';
const T = '64b7f0c2a1b2c3d4e5f60702';
const S = '64b7f0c2a1b2c3d4e5f60703';
const U = '64b7f0c2a1b2c3d4e5f60704';

const before: TaskSnapshot = { _id: T, project: P, title: 'Login page', status: 'in_progress', assignee: null, sprint: S };

function facts(partial: Partial<EventFacts> & Pick<EventFacts, 'route'>): EventFacts {
  return { params: {}, body: {}, response: null, names: {}, ...partial };
}

describe('task events', () => {
  it('created task', () => {
    const [e] = describeEvents(
      facts({ route: 'POST /tasks', body: { project: P, title: 'Login page' }, response: { _id: T, title: 'Login page', status: 'todo', priority: 'medium' } }),
    );
    expect(e).toEqual({ project: P, action: 'task.created', text: 'created “Login page”', task: T });
  });

  it('a developer’s task becomes an approval request', () => {
    const [e] = describeEvents(
      facts({
        route: 'POST /tasks',
        body: { project: P, title: 'Login page' },
        response: { _id: 'r1', type: 'create_task', requestedBy: U, status: 'pending', taskTitle: 'Login page' },
      }),
    );
    expect(e.action).toBe('task.create_requested');
    expect(e.text).toBe('asked to create “Login page”');
  });

  it('moved between columns', () => {
    const events = describeEvents(facts({ route: 'PATCH /tasks/:id', params: { id: T }, body: { status: 'review' }, before }));
    expect(events).toEqual([
      { project: P, task: T, action: 'task.moved', text: 'moved “Login page” from In Progress to Review' },
    ]);
  });

  it('sent back from Review is its own event', () => {
    const [e] = describeEvents(
      facts({ route: 'PATCH /tasks/:id', body: { status: 'in_progress', reviewComment: 'fix' }, before: { ...before, status: 'review' } }),
    );
    expect(e.action).toBe('task.sent_back');
    expect(e.text).toBe('sent “Login page” back to In Progress');
  });

  it('records nothing when the status did not change', () => {
    expect(describeEvents(facts({ route: 'PATCH /tasks/:id', body: { status: 'in_progress' }, before }))).toEqual([]);
  });

  it('assign, unassign, edit and take out of a sprint in one call', () => {
    const events = describeEvents(
      facts({
        route: 'PATCH /tasks/:id',
        body: { assignee: U, priority: 'high', storyPoints: 5, sprint: null },
        before,
        names: { [U]: 'Jovika', [S]: 'Sprint 3' },
      }),
    );
    expect(events.map((e) => e.text)).toEqual([
      'assigned “Login page” to Jovika',
      'took “Login page” out of Sprint 3',
      'changed the priority, story points of “Login page”',
    ]);
    const unassigned = describeEvents(facts({ route: 'PATCH /tasks/:id', body: { assignee: null }, before: { ...before, assignee: U } }));
    expect(unassigned[0].text).toBe('unassigned “Login page”');
  });

  it('deleted, or asked to delete', () => {
    expect(describeEvents(facts({ route: 'DELETE /tasks/:id', before, response: { deleted: true } }))[0]).toEqual({
      project: P,
      task: null,
      action: 'task.deleted',
      text: 'deleted “Login page”',
    });
    const asked = describeEvents(
      facts({ route: 'DELETE /tasks/:id', before, response: { type: 'delete_task', requestedBy: U, status: 'pending' } }),
    );
    expect(asked[0].action).toBe('task.delete_requested');
  });

  it('records nothing for a task that was not found before the call', () => {
    expect(describeEvents(facts({ route: 'PATCH /tasks/:id', body: { status: 'done' }, before: null }))).toEqual([]);
  });

  it('added to a sprint', () => {
    const [e] = describeEvents(
      facts({ route: 'PATCH /tasks/:id/sprint/:sprintId', params: { id: T, sprintId: S }, before, names: { [S]: 'Sprint 3' } }),
    );
    expect(e.text).toBe('added “Login page” to Sprint 3');
    expect(e.sprint).toBe(S);
  });
});

describe('sprint events', () => {
  const sprint = { _id: S, project: P, name: 'Sprint 3' };

  it('created, started', () => {
    expect(describeEvents(facts({ route: 'POST /sprints', response: sprint }))[0].text).toBe('created Sprint 3');
    expect(describeEvents(facts({ route: 'PATCH /sprints/:id/start', response: sprint }))[0].text).toBe('started Sprint 3');
  });

  it('completed, with where the unfinished work went', () => {
    const [toBacklog] = describeEvents(
      facts({ route: 'PATCH /sprints/:id/complete', response: { sprint, movedCount: 2, movedToSprint: null } }),
    );
    expect(toBacklog.text).toBe('completed Sprint 3; 2 unfinished tasks moved to the backlog');
    const [toNext] = describeEvents(
      facts({ route: 'PATCH /sprints/:id/complete', response: { sprint, movedCount: 1, movedToSprint: { _id: 'x', name: 'Polish' } } }),
    );
    expect(toNext.text).toBe('completed Sprint 3; 1 unfinished task moved to sprint Polish');
  });
});

describe('approvals and team', () => {
  it('approved and rejected requests', () => {
    const approval = { project: P, type: 'delete_task', taskTitle: 'Old page', requesterName: 'Punya' };
    expect(describeEvents(facts({ route: 'PATCH /approvals/:id/approve', approval }))[0].text).toBe(
      'approved Punya\'s request to delete “Old page”',
    );
    expect(
      describeEvents(facts({ route: 'PATCH /approvals/:id/reject', approval: { ...approval, type: 'create_task' } }))[0].text,
    ).toBe('rejected Punya\'s request to create “Old page”');
  });

  it('members added, removed and joining', () => {
    const params = { id: P, userId: U };
    expect(describeEvents(facts({ route: 'PATCH /projects/:id/members/:userId', params, names: { [U]: 'Madhura' } }))[0].text).toBe(
      'added Madhura to the team',
    );
    expect(describeEvents(facts({ route: 'DELETE /projects/:id/members/:userId', params, names: { [U]: 'Madhura' } }))[0].text).toBe(
      'removed Madhura from the team',
    );
    expect(describeEvents(facts({ route: 'PATCH /team-invites/:id/accept', invite: { project: P } }))[0].action).toBe('member.joined');
  });
});

describe('helpers', () => {
  it('quote shortens long titles', () => {
    expect(quote('x'.repeat(100)).length).toBe(82);
    expect(quote('')).toBe('“a task”');
  });

  it('sprintLabel', () => {
    expect(sprintLabel('Sprint 3')).toBe('Sprint 3');
    expect(sprintLabel('Polish')).toBe('sprint Polish');
    expect(sprintLabel('')).toBe('a sprint');
  });

  it('taskLink goes to the board the task is on', () => {
    expect(taskLink({ _id: P, methodology: 'kanban' }, { _id: T })).toBe(`/projects/${P}/kanban?comments=${T}`);
    expect(taskLink({ _id: P }, { _id: T, sprint: S })).toBe(`/projects/${P}/sprints?comments=${T}`);
    expect(taskLink({ _id: P }, { _id: T, sprint: null })).toBe(`/projects/${P}/activity?task=${T}`);
  });
});
