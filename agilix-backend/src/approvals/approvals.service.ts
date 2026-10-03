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
    return [...pending, ...decided];
  }

  async decide(user: AuthUser, id: string, approve: boolean) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new ForbiddenException(MANAGER_ONLY_MESSAGE);
    }
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid request id');

    const request = await this.approvalModel.findById(id);
    if (!request) throw new NotFoundException('Request not found');
    await this.access.assertProject(user, String(request.project));

    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }

    let outcome = '';
    if (approve) {
      if (request.type === ApprovalType.CREATE_TASK) {
        const data = { ...(request.taskData ?? {}) } as Record<string, unknown> & {
          assignee?: string;
        };
        // The person may have left the team since the request was made.
        if (data.assignee) {
          await this.access.assertAssignee(String(request.project), String(data.assignee));
        }
        await this.connection.model('Task').create({ ...data, project: request.project });
        outcome = 'approved. The task has been created.';
      } else if (request.task) {
        const deleted = await deleteTaskAndTime(this.connection, String(request.task));
        outcome = deleted ? 'approved. The task has been deleted.' : 'approved (the task was already gone).';
      }
    } else {
      outcome = 'not approved.';
    }

    request.status = approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    request.decidedBy = user.userId as never;
    request.decidedAt = new Date();
    await request.save();

    const verb = request.type === ApprovalType.CREATE_TASK ? 'create' : 'delete';
    await this.notifications.notify([String(request.requestedBy)], {
      kind: 'approval_decided',
      text: `Your request to ${verb} “${request.taskTitle}” was ${outcome}`,
      detail: await this.projectName(String(request.project)),
      link: `/projects/${String(request.project)}/approvals`,
    });

    return request;
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
