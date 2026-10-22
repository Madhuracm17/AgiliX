/*
 * Turns one successful API call into activity entries such as
 * "moved “Login page” from In Progress to Review".
 *
 * Pure functions (no Nest, no database) so every rule is unit tested. The
 * ActivityInterceptor collects the facts (the task before the change, the
 * response, people's and sprints' names) and passes them in.
 */

/** The routes the activity log listens to: "<METHOD> <route path>". */
export const TRACKED_ROUTES = [
  'POST /tasks',
  'PATCH /tasks/:id',
  'DELETE /tasks/:id',
  'PATCH /tasks/:id/sprint/:sprintId',
  'POST /sprints',
  'PATCH /sprints/:id',
  'PATCH /sprints/:id/start',
  'PATCH /sprints/:id/complete',
  'PATCH /approvals/:id/approve',
  'PATCH /approvals/:id/reject',
  'PATCH /projects/:id/members/:userId',
  'DELETE /projects/:id/members/:userId',
  'PATCH /team-invites/:id/accept',
] as const;

export type TrackedRoute = (typeof TRACKED_ROUTES)[number];

export type ActivityAction =
  | 'task.created'
  | 'task.create_requested'
  | 'task.moved'
  | 'task.sent_back'
  | 'task.assigned'
  | 'task.edited'
  | 'task.added_to_sprint'
  | 'task.removed_from_sprint'
  | 'task.deleted'
  | 'task.delete_requested'
  | 'sprint.created'
  | 'sprint.edited'
  | 'sprint.started'
  | 'sprint.completed'
  | 'approval.approved'
  | 'approval.rejected'
  | 'member.added'
  | 'member.removed'
  | 'member.joined'
  | 'comment.added';

/** One entry, before the actor and time are added. */
export interface ActivityDraft {
  project: string;
  action: ActivityAction;
  /** What happened, without the actor's name (the feed puts the name in front). */
  text: string;
  task?: string | null;
  sprint?: string | null;
}

/** The task as it was before the call (PATCH / DELETE only). */
export interface TaskSnapshot {
  _id: string;
  project: string;
  title: string;
  status: string;
  assignee: string | null;
  sprint: string | null;
}

export interface EventFacts {
  route: TrackedRoute;
  params: Record<string, string>;
  /** The request body (already validated by Nest). */
  body: Record<string, unknown>;
  /** The handler's response, as a plain object. */
  response: Record<string, unknown> | null;
  /** PATCH / DELETE of a task: the task before the call. */
  before?: TaskSnapshot | null;
  /** Approvals: the request before the decision. */
  approval?: { project: string; type: string; taskTitle: string; requesterName: string; taskId?: string } | null;
  /** Team invite: the invite that was accepted. */
  invite?: { project: string } | null;
  /** id → display name, for assignees, members and sprints. */
  names: Record<string, string>;
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

/** "Sprint 3" stays as it is; "Login" becomes "sprint Login". */
export function sprintLabel(name: string | undefined | null): string {
  const clean = (name ?? '').trim();
  if (!clean) return 'a sprint';
  return /^sprint\b/i.test(clean) ? clean : `sprint ${clean}`;
}

/** “Title” with curly quotes, shortened if very long. */
export function quote(title: string): string {
  const clean = (title ?? '').trim() || 'a task';
  return `“${clean.length > 80 ? `${clean.slice(0, 77)}...` : clean}”`;
}

/** Makes ids comparable: populated objects, ObjectIds and strings all become a string. */
export function idOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && '_id' in (value as object)) return String((value as { _id: unknown })._id);
  return String(value);
}

const EDIT_FIELDS: Array<[string, string]> = [
  ['title', 'title'],
  ['description', 'description'],
  ['priority', 'priority'],
  ['storyPoints', 'story points'],
  ['type', 'type'],
];

/** Did the handler create an approval request instead of doing the change? */
function isApprovalRequest(response: Record<string, unknown> | null): boolean {
  return !!response && 'requestedBy' in response && 'type' in response && !('status' in response && 'priority' in response);
}

export function describeEvents(f: EventFacts): ActivityDraft[] {
  const r = f.response ?? {};
  const name = (id: string | null | undefined, fallback: string) => (id && f.names[id]) || fallback;

  switch (f.route) {
    case 'POST /tasks': {
      const project = idOf(f.body.project) ?? idOf(r.project);
      if (!project) return [];
      if (isApprovalRequest(f.response)) {
        return [{ project, action: 'task.create_requested', text: `asked to create ${quote(String(f.body.title ?? ''))}` }];
      }
      return [{ project, action: 'task.created', text: `created ${quote(String(r.title ?? f.body.title ?? ''))}`, task: idOf(r._id) }];
    }

    case 'PATCH /tasks/:id': {
      const b = f.before;
      if (!b) return [];
      const base = { project: b.project, task: b._id };
      const title = quote(String(r.title ?? b.title));
      const events: ActivityDraft[] = [];

      const newStatus = typeof f.body.status === 'string' ? f.body.status : null;
      if (newStatus && newStatus !== b.status) {
        const sentBack = b.status === 'review' && newStatus === 'in_progress';
        events.push({
          ...base,
          action: sentBack ? 'task.sent_back' : 'task.moved',
          text: sentBack
            ? `sent ${title} back to In Progress`
            : `moved ${title} from ${statusLabel(b.status)} to ${statusLabel(newStatus)}`,
        });
      }

      if ('assignee' in f.body) {
        const to = idOf(f.body.assignee);
        if (to !== b.assignee) {
          events.push({
            ...base,
            action: 'task.assigned',
            text: to ? `assigned ${title} to ${name(to, 'a team member')}` : `unassigned ${title}`,
          });
        }
      }

      if ('sprint' in f.body && f.body.sprint === null && b.sprint) {
        events.push({
          ...base,
          sprint: b.sprint,
          action: 'task.removed_from_sprint',
          text: `took ${title} out of ${name(b.sprint, 'its sprint')}`,
        });
      }

      const edited = EDIT_FIELDS.filter(([key]) => key in f.body).map(([, label]) => label);
      if (edited.length) {
        events.push({ ...base, action: 'task.edited', text: `changed the ${edited.join(', ')} of ${title}` });
      }
      return events;
    }

    case 'DELETE /tasks/:id': {
      const b = f.before;
      if (!b) return [];
      if (isApprovalRequest(f.response)) {
        return [{ project: b.project, task: b._id, action: 'task.delete_requested', text: `asked to delete ${quote(b.title)}` }];
      }
      return [{ project: b.project, task: null, action: 'task.deleted', text: `deleted ${quote(b.title)}` }];
    }

    case 'PATCH /tasks/:id/sprint/:sprintId': {
      const b = f.before;
      if (!b) return [];
      const sprintId = f.params.sprintId;
      return [
        {
          project: b.project,
          task: b._id,
          sprint: sprintId,
          action: 'task.added_to_sprint',
          text: `added ${quote(b.title)} to ${name(sprintId, 'a sprint')}`,
        },
      ];
    }

    case 'POST /sprints':
    case 'PATCH /sprints/:id':
    case 'PATCH /sprints/:id/start':
    case 'PATCH /sprints/:id/complete': {
      // complete returns { sprint, movedCount, movedToSprint }; the others return the sprint.
      const sprint = (f.route === 'PATCH /sprints/:id/complete' ? (r.sprint as Record<string, unknown>) : r) ?? {};
      const project = idOf(sprint.project);
      const sprintId = idOf(sprint._id);
      if (!project) return [];
      const label = sprintLabel(sprint.name as string | undefined);
      const base = { project, sprint: sprintId };
      if (f.route === 'POST /sprints') return [{ ...base, action: 'sprint.created', text: `created ${label}` }];
      if (f.route === 'PATCH /sprints/:id') return [{ ...base, action: 'sprint.edited', text: `edited ${label}` }];
      if (f.route === 'PATCH /sprints/:id/start') return [{ ...base, action: 'sprint.started', text: `started ${label}` }];
      const moved = Number(r.movedCount ?? 0);
      const target = r.movedToSprint as { name?: string } | null | undefined;
      const tail = moved
        ? `; ${moved} unfinished ${moved === 1 ? 'task' : 'tasks'} moved to ${target?.name ? sprintLabel(target.name) : 'the backlog'}`
        : '';
      return [{ ...base, action: 'sprint.completed', text: `completed ${label}${tail}` }];
    }

    case 'PATCH /approvals/:id/approve':
    case 'PATCH /approvals/:id/reject': {
      const a = f.approval;
      if (!a) return [];
      const approved = f.route === 'PATCH /approvals/:id/approve';
      const what = a.type.includes('delete') ? 'delete' : 'create';
      return [
        {
          project: a.project,
          action: approved ? 'approval.approved' : 'approval.rejected',
          text: `${approved ? 'approved' : 'rejected'} ${a.requesterName}'s request to ${what} ${quote(a.taskTitle)}`,
        },
      ];
    }

    case 'PATCH /projects/:id/members/:userId':
    case 'DELETE /projects/:id/members/:userId': {
      const added = f.route.startsWith('PATCH');
      const who = name(f.params.userId, 'someone');
      return [
        {
          project: f.params.id,
          action: added ? 'member.added' : 'member.removed',
          text: added ? `added ${who} to the team` : `removed ${who} from the team`,
        },
      ];
    }

    case 'PATCH /team-invites/:id/accept': {
      if (!f.invite) return [];
      return [{ project: f.invite.project, action: 'member.joined', text: 'joined the team' }];
    }

    default:
      return [];
  }
}

/** Where a click on an entry (or a comment notification) should go. */
export function taskLink(project: { _id: string; methodology?: string }, task: { _id: string; sprint?: unknown }): string {
  if ((project.methodology ?? 'scrum') === 'kanban') return `/projects/${project._id}/kanban?comments=${task._id}`;
  if (task.sprint) return `/projects/${project._id}/sprints?comments=${task._id}`;
  return `/projects/${project._id}/activity?task=${task._id}`;
}
