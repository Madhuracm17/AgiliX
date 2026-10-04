import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model } from 'mongoose';
import {
  ApprovalRequest,
  ApprovalRequestDocument,
  ApprovalStatus,
  ApprovalType,
} from './schemas/approval-request.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessService, belongsTo, ProjectAccess } from '../auth/access.service';
import { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { deleteTaskAndTime } from '../tasks/task-cleanup';

/** What the web app shows after a developer or tester asks for approval. */
export interface PendingApproval {
  pendingApproval: true;
  requestId: string;
  message: string;
}

/** Where a manager can put a task: the backlog, or the current (active) sprint. */
export type PlaceAction = 'backlog' | 'sprint';
const PLACE_ACTIONS: PlaceAction[] = ['backlog', 'sprint'];

const MANAGER_ONLY_MESSAGE =
  'Only a manager or an admin can approve or reject requests. Please contact a manager.';

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectModel(ApprovalRequest.name) private approvalModel: Model<ApprovalRequestDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Asking for approval (developers and testers)
  // ---------------------------------------------------------------------------

  async requestCreate(user: AuthUser, dto: CreateTaskDto): Promise<PendingApproval> {
    const request = await this.approvalModel.create({
      project: dto.project,
      type: ApprovalType.CREATE_TASK,
      requestedBy: user.userId,
      taskTitle: dto.title,
      taskData: { ...dto },
    });
    await this.notifyManagers(
      dto.project,
      user.userId,
      `${await this.nameOf(user.userId)} asked to create the task “${dto.title}”`,
    );
    return {
      pendingApproval: true,
      requestId: String(request._id),
      message: 'Your request was sent to a manager. The task is created once they approve it.',
    };
  }

  async requestDelete(user: AuthUser, taskId: string, projectId: string): Promise<PendingApproval> {
    const task = (await this.connection
      .model('Task')
      .findById(taskId)
      .select('title status')
      .lean()
      .exec()) as { title?: string; status?: string } | null;
    if (!task) throw new NotFoundException('Task not found');

    // Developers and testers can only ask to delete a task that has not been started.
    if (task.status && task.status !== 'todo') {
      throw new BadRequestException(
        'You can only ask a manager to delete a task while it is in To Do.',
      );
    }

    const already = await this.approvalModel.exists({
      task: taskId,
      type: ApprovalType.DELETE_TASK,
      status: ApprovalStatus.PENDING,
    });
    if (already) {
      throw new BadRequestException('A request to delete this task is already waiting for a manager.');
    }
    // Once a manager has said no, the same task cannot be asked about again.
    const declined = await this.approvalModel.exists({
      task: taskId,
      type: ApprovalType.DELETE_TASK,
      status: ApprovalStatus.REJECTED,
    });
    if (declined) {
      throw new BadRequestException(
        'A manager has already declined the request to delete this task, so it cannot be requested again.',
      );
    }

    const request = await this.approvalModel.create({
      project: projectId,
      type: ApprovalType.DELETE_TASK,
      requestedBy: user.userId,
      task: taskId,
      taskTitle: task.title ?? '',
    });
    await this.notifyManagers(
      projectId,
      user.userId,
      `${await this.nameOf(user.userId)} asked to delete the task “${task.title ?? ''}”`,
    );
    return {
      pendingApproval: true,
      requestId: String(request._id),
      message: 'Your request was sent to a manager. The task is deleted once they approve it.',
    };
  }

  // ---------------------------------------------------------------------------
  // Reading and deciding
  // ---------------------------------------------------------------------------

  /**
   * Managers and admins see every request on the project; developers and testers
   * only their own. Pending ones come first, then the most recent decisions.
   */
  async list(user: AuthUser, projectId: string) {
    const isReviewer = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    const filter: Record<string, unknown> = { project: projectId };
    if (!isReviewer) filter.requestedBy = user.userId;

    const [pending, decided] = await Promise.all([
      this.approvalModel
        .find({ ...filter, status: ApprovalStatus.PENDING })
        .sort({ createdAt: -1 })
        .populate('requestedBy', 'name role')
        .lean()
        .exec(),
      this.approvalModel
        .find({ ...filter, status: { $ne: ApprovalStatus.PENDING } })
        .sort({ decidedAt: -1 })
        .limit(20)
        .populate('requestedBy', 'name role')
        .lean()
        .exec(),
    ]);
    // Waiting delete requests also say where the task is now, so a manager is only
    // offered the moves that make sense (not "to the backlog" for a backlog task).
    const active = isReviewer ? await this.activeSprint(projectId) : null;
    const enriched = await Promise.all(
      pending.map(async (request) => {
        if (!isReviewer) return request;
        // Every waiting request says which sprint is the current one, so "add to the
        // current sprint" can be switched off when there is none.
        if (request.type !== ApprovalType.DELETE_TASK || !request.task) {
          return { ...request, activeSprintName: active?.name ?? null };
        }
        const task = (await this.connection
          .model('Task')
          .findById(request.task)
          .select('sprint')
          .lean()
          .exec()) as unknown as { sprint?: unknown } | null;
        const where = !task
          ? 'missing'
          : !task.sprint
            ? 'backlog'
            : active && String(task.sprint) === String(active._id)
              ? 'current_sprint'
              : 'other_sprint';
        return { ...request, taskLocation: where, activeSprintName: active?.name ?? null };
      }),
    );
    return [...enriched, ...decided];
  }

  /**
   * Which tasks cannot be asked about any more, whoever asked: the ones with a
   * delete request waiting, and the ones a manager already declined. Lets the web
   * app switch off "Request deletion" for everyone on the project.
   */
  async deleteRequestState(projectId: string): Promise<{ pending: string[]; declined: string[] }> {
    const rows = (await this.approvalModel
      .find({
        project: projectId,
        type: ApprovalType.DELETE_TASK,
        status: { $in: [ApprovalStatus.PENDING, ApprovalStatus.REJECTED] },
      })
      .select('task status')
      .lean()
      .exec()) as unknown as { task?: unknown; status?: string }[];
    const ids = (status: ApprovalStatus) =>
      rows.filter((r) => r.task && r.status === status).map((r) => String(r.task));
    return { pending: ids(ApprovalStatus.PENDING), declined: ids(ApprovalStatus.REJECTED) };
  }

  /**
   * A manager (or admin) decides a request.
   * - Approve a create request: the task is created, in the backlog or (action
   *   "sprint") in the current sprint.
   * - Approve a delete request: the task is deleted.
   * - Reject a delete request: the task is kept. Optionally (action "backlog" or
   *   "sprint") it is also moved to the backlog or into the current sprint.
   * - Reject a create request: nothing is created.
   */
  async decide(user: AuthUser, id: string, approve: boolean, action?: PlaceAction) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new ForbiddenException(MANAGER_ONLY_MESSAGE);
    }
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid request id');
    if (action !== undefined && !PLACE_ACTIONS.includes(action)) {
      throw new BadRequestException('Choose backlog or sprint.');
    }

    const request = await this.approvalModel.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    const projectId = String(request.project);
    await this.access.assertProject(user, projectId);

    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }

    let outcome = '';
    if (request.type === ApprovalType.CREATE_TASK) {
      if (approve) {
        const data = { ...(request.taskData ?? {}) } as Record<string, unknown> & {
          assignee?: string;
        };
        // The person may have left the team since the request was made.
        if (data.assignee) {
          await this.access.assertAssignee(projectId, String(data.assignee));
        }
        let sprintFields: Record<string, unknown> = { sprint: null };
        let where = 'in the backlog';
        if (action === 'sprint') {
          const sprint = await this.requireActiveSprint(projectId);
          sprintFields = { sprint: sprint._id, addedToSprintAt: new Date() };
          where = `in the current sprint (${sprint.name})`;
        }
        await this.connection.model('Task').create({ ...data, project: request.project, ...sprintFields });
        outcome = `approved. The task has been created ${where}.`;
      } else {
        outcome = 'not approved.';
      }
    } else if (request.task) {
      const taskId = String(request.task);
      if (approve) {
        const deleted = await deleteTaskAndTime(this.connection, taskId);
        outcome = deleted ? 'approved. The task has been deleted.' : 'approved (the task was already gone).';
      } else if (action) {
        outcome = `not approved. ${await this.moveTask(projectId, taskId, action)}`;
      } else {
        outcome = 'not approved. The task was kept.';
      }
    }

    request.status = approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    request.decidedBy = user.userId as never;
    request.decidedAt = new Date();
    await request.save();

    const verb = request.type === ApprovalType.CREATE_TASK ? 'create' : 'delete';
    await this.notifications.notify([String(request.requestedBy)], {
      kind: 'approval_decided',
      text: `Your request to ${verb} “${request.taskTitle}” was ${outcome}`,
      detail: await this.projectName(projectId),
      link: `/projects/${projectId}/approvals`,
    });

    return request;
  }

  /** Keeps a task and puts it in the backlog or the current sprint. Returns a sentence about it. */
  private async moveTask(projectId: string, taskId: string, action: PlaceAction): Promise<string> {
    const Task = this.connection.model('Task');
    const task = (await Task.findById(taskId).select('sprint').lean().exec()) as unknown as
      | { sprint?: unknown }
      | null;
    if (!task) throw new NotFoundException('This task no longer exists.');

    if (action === 'backlog') {
      if (!task.sprint) throw new BadRequestException('This task is already in the backlog.');
      await Task.updateOne({ _id: taskId }, { $set: { sprint: null, addedToSprintAt: null } }).exec();
      return 'The task was kept and moved to the backlog.';
    }

    const sprint = await this.requireActiveSprint(projectId);
    if (task.sprint && String(task.sprint) === String(sprint._id)) {
      throw new BadRequestException('This task is already in the current sprint.');
    }
    await Task.updateOne(
      { _id: taskId },
      { $set: { sprint: sprint._id, addedToSprintAt: new Date() } },
    ).exec();
    return `The task was kept and moved to the current sprint (${sprint.name}).`;
  }

  private async requireActiveSprint(projectId: string): Promise<{ _id: unknown; name: string }> {
    const sprint = await this.activeSprint(projectId);
    if (!sprint) {
      throw new BadRequestException('There is no active sprint right now. Start a sprint first.');
    }
    return sprint;
  }

  private async activeSprint(projectId: string): Promise<{ _id: unknown; name: string } | null> {
    return (await this.connection
      .model('Sprint')
      .findOne({ project: projectId, status: 'active' })
      .select('name')
      .lean()
      .exec()) as unknown as { _id: unknown; name: string } | null;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /** Managers on the project (owner or member) get told about a new request. */
  private async notifyManagers(projectId: string, requesterId: string, text: string) {
    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('owner members name')
      .lean()
      .exec()) as (ProjectAccess & { name?: string }) | null;
    if (!project) return;

    const candidateIds = [project.owner, ...(project.members ?? [])]
      .filter((id) => id != null)
      .map((id) => String(id))
      .filter((id) => isValidObjectId(id) && id !== requesterId);

    const managers = (await this.connection
      .model('User')
      .find({ _id: { $in: candidateIds }, role: UserRole.MANAGER })
      .select('_id')
      .lean()
      .exec()) as { _id: unknown }[];

    // Anyone who can see the project belongs to it; this keeps the list honest.
    const ids = managers.map((m) => String(m._id)).filter((id) => belongsTo(project, id));
    await this.notifications.notify(ids, {
      kind: 'approval_requested',
      text,
      detail: project.name ?? '',
      link: `/projects/${projectId}/approvals`,
    });
  }

  private async nameOf(userId: string): Promise<string> {
    const person = (await this.connection
      .model('User')
      .findById(userId)
      .select('name')
      .lean()
      .exec()) as { name?: string } | null;
    return person?.name ?? 'Someone';
  }

  private async projectName(projectId: string): Promise<string> {
    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('name')
      .lean()
      .exec()) as { name?: string } | null;
    return project?.name ?? '';
  }
}
