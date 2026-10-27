import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Types } from 'mongoose';
import { from, Observable, switchMap, tap } from 'rxjs';
import type { AuthUser } from '../auth/jwt-config';
import { describeEvents, EventFacts, idOf, sprintLabel, TaskSnapshot, TRACKED_ROUTES, TrackedRoute } from './activity-events';
import { ActivityService } from './activity.service';

interface HttpRequest {
  method: string;
  route?: { path?: string };
  params: Record<string, string>;
  body?: Record<string, unknown>;
  user?: AuthUser;
}

type Before = Pick<EventFacts, 'before' | 'approval' | 'invite'>;

/**
 * Records the activity log WITHOUT changing the task, sprint, approval or team
 * code: it watches the API routes listed in TRACKED_ROUTES, and after a call
 * succeeds it writes what happened. Failed calls (403, 400...) are not logged.
 *
 * Registered app-wide by CollaborationModule (APP_INTERCEPTOR). It runs after
 * the login guard, so the actor is the logged-in user.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Activity');

  constructor(
    private readonly activity: ActivityService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<HttpRequest>();
    const key = `${req.method} ${req.route?.path ?? ''}` as TrackedRoute;
    if (!(TRACKED_ROUTES as readonly string[]).includes(key) || !req.user) return next.handle();

    const user = req.user;
    return from(this.loadBefore(key, req.params).catch(() => ({}) as Before)).pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap((response) => {
            // In the background: the response is not delayed by the log.
            void this.after(key, req, user, before, response);
          }),
        ),
      ),
    );
  }

  /**
   * The same recording for callers that do not go through HTTP (the MCP write
   * tools call the controllers directly): runs `call`, then logs it if it worked.
   */
  async track<T>(
    route: TrackedRoute,
    params: Record<string, string>,
    body: Record<string, unknown>,
    user: AuthUser,
    call: () => Promise<T>,
  ): Promise<T> {
    const before = await this.loadBefore(route, params).catch(() => ({}) as Before);
    const result = await call();
    void this.after(route, { method: '', params, body, user }, user, before, result);
    return result;
  }

  /** Facts that are gone after the call (a deleted task's title, a task's old status). */
  private async loadBefore(route: TrackedRoute, params: Record<string, string>): Promise<Before> {
    if (route.startsWith('PATCH /tasks/:id') || route === 'DELETE /tasks/:id') {
      return { before: await this.taskSnapshot(params.id) };
    }
    if (route.startsWith('PATCH /approvals/')) {
      if (!isValidObjectId(params.id)) return {};
      const a = (await this.connection
        .model('ApprovalRequest')
        .findById(params.id)
        .select('project type taskTitle requestedBy task')
        .lean()
        .exec()) as { project?: unknown; type?: string; taskTitle?: string; requestedBy?: unknown; task?: unknown } | null;
      if (!a) return {};
      const requester = await this.nameOf(idOf(a.requestedBy));
      return {
        approval: {
          project: String(a.project),
          type: String(a.type ?? ''),
          taskTitle: a.taskTitle ?? '',
          requesterName: requester || 'someone',
          ...(a.task ? { taskId: String(a.task) } : {}),
        },
      };
    }
    if (route === 'PATCH /team-invites/:id/accept') {
      if (!isValidObjectId(params.id)) return {};
      const invite = (await this.connection.model('TeamInvite').findById(params.id).select('project').lean().exec()) as {
        project?: unknown;
      } | null;
      return invite ? { invite: { project: String(invite.project) } } : {};
    }
    return {};
  }

  private async after(route: TrackedRoute, req: HttpRequest, user: AuthUser, before: Before, response: unknown) {
    try {
      const body = req.body ?? {};
      const plainResponse = toPlain(response);
      const ids = [idOf(body.assignee), req.params.sprintId, before.before?.sprint, req.params.userId].filter(
        (id): id is string => !!id && isValidObjectId(id),
      );
      const facts: EventFacts = {
        route,
        params: req.params,
        body,
        response: plainResponse,
        ...before,
        names: await this.namesOf(ids),
      };
      await this.activity.record(user.userId, describeEvents(facts));
      await this.cleanUpComments(route, before, plainResponse);
    } catch (error) {
      this.logger.warn(`Activity not recorded for ${route}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A deleted task's comments go with it. */
  private async cleanUpComments(route: TrackedRoute, before: Before, response: Record<string, unknown> | null) {
    let taskId: string | null = null;
    if (route === 'DELETE /tasks/:id' && response?.deleted === true) taskId = before.before?._id ?? null;
    const approval = before.approval;
    if (route === 'PATCH /approvals/:id/approve' && approval?.type.includes('delete')) taskId = approval.taskId ?? null;
    if (!taskId || !isValidObjectId(taskId)) return;
    await this.connection.model('Comment').deleteMany({ task: new Types.ObjectId(taskId) }).exec();
  }

  private async taskSnapshot(id: string | undefined): Promise<TaskSnapshot | null> {
    if (!id || !isValidObjectId(id)) return null;
    const t = (await this.connection
      .model('Task')
      .findById(id)
      .select('project title status assignee sprint')
      .lean()
      .exec()) as { _id: unknown; project?: unknown; title?: string; status?: string; assignee?: unknown; sprint?: unknown } | null;
    if (!t) return null;
    return {
      _id: String(t._id),
      project: String(t.project),
      title: t.title ?? '',
      status: t.status ?? '',
      assignee: idOf(t.assignee),
      sprint: idOf(t.sprint),
    };
  }

  /** Names of people and sprints, by id. */
  private async namesOf(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const [users, sprints] = await Promise.all([
      this.connection.model('User').find({ _id: { $in: unique } }).select('name').lean().exec(),
      this.connection.model('Sprint').find({ _id: { $in: unique } }).select('name').lean().exec(),
    ]);
    const names: Record<string, string> = {};
    for (const u of users as Array<{ _id: unknown; name?: string }>) names[String(u._id)] = u.name ?? '';
    for (const s of sprints as Array<{ _id: unknown; name?: string }>) names[String(s._id)] = sprintLabel(s.name);
    return names;
  }

  private async nameOf(id: string | null): Promise<string> {
    if (!id || !isValidObjectId(id)) return '';
    const u = (await this.connection.model('User').findById(id).select('name').lean().exec()) as { name?: string } | null;
    return u?.name ?? '';
  }
}

/** Mongoose documents → plain objects; anything else as it is. */
function toPlain(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const doc = value as { toObject?: () => Record<string, unknown> };
  return typeof doc.toObject === 'function' ? doc.toObject() : (value as Record<string, unknown>);
}
