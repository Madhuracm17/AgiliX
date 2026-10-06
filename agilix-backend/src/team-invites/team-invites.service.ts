import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { InviteStatus, TeamInvite, TeamInviteDocument } from './schemas/team-invite.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessService, belongsTo, ProjectAccess } from '../auth/access.service';
import { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';

type Person = { _id: unknown; name?: string; email?: string; role?: string };

/**
 * Team requests. A manager asks a developer or tester to join a project; the
 * person sees the request on their dashboard and accepts or declines it.
 * Admins add managers directly (see ProjectsService), so they do not use this.
 */
@Injectable()
export class TeamInvitesService {
  constructor(
    @InjectModel(TeamInvite.name) private inviteModel: Model<TeamInviteDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
  ) {}

  /** Sends a request. Only managers send them, and only to developers and testers. */
  async create(user: AuthUser, projectId: string, inviteeId: string) {
    if (user.role !== UserRole.MANAGER) {
      throw new ForbiddenException(
        'Only a manager can send a team request. Admins add managers directly.',
      );
    }
    await this.access.assertProject(user, projectId);
    return this.send(user.userId, projectId, inviteeId);
  }

  /**
   * Shared by "Send request" and by creating a project with people chosen.
   * The caller has already checked that the sender may use the project.
   */
  async send(managerId: string, projectId: string, inviteeId: string) {
    if (!isValidObjectId(inviteeId)) throw new BadRequestException('Invalid user id');

    const [project, invitee] = await Promise.all([
      this.connection
        .model('Project')
        .findById(projectId)
        .select('owner members name')
        .lean()
        .exec() as unknown as Promise<(ProjectAccess & { name?: string }) | null>,
      this.connection
        .model('User')
        .findById(inviteeId)
        .select('name role')
        .lean()
        .exec() as unknown as Promise<Person | null>,
    ]);
    if (!project) throw new NotFoundException('Project not found');
    if (!invitee) throw new NotFoundException('That person does not exist');

    if (invitee.role !== UserRole.DEVELOPER && invitee.role !== UserRole.TESTER) {
      throw new BadRequestException('Team requests can only be sent to developers and testers.');
    }
    if (belongsTo(project, inviteeId)) {
      throw new BadRequestException(`${invitee.name ?? 'This person'} is already on the team.`);
    }
    const waiting = await this.inviteModel.exists({
      project: projectId,
      invitee: inviteeId,
      status: InviteStatus.PENDING,
    });
    if (waiting) {
      throw new BadRequestException(
        `A request to ${invitee.name ?? 'this person'} is already waiting for an answer.`,
      );
    }

    const invite = await this.inviteModel.create({
      project: projectId,
      invitee: inviteeId,
      invitedBy: managerId,
    });
    await this.notifications.notify([inviteeId], {
      kind: 'team_invite',
      text: `${await this.nameOf(managerId)} asked you to join the team of “${project.name ?? ''}”`,
      detail: 'Open your dashboard to accept or decline',
      link: '/dashboard',
    });
    return invite;
  }

  /** Requests still waiting on a project (managers and admins). */
  async listForProject(user: AuthUser, projectId: string) {
    await this.access.assertProject(user, projectId);
    if (user.role !== UserRole.MANAGER && user.role !== UserRole.ADMIN) return [];
    return this.inviteModel
      .find({ project: projectId, status: InviteStatus.PENDING })
      .sort({ createdAt: -1 })
      .populate('invitee', 'name email role')
      .populate('invitedBy', 'name')
      .lean()
      .exec();
  }

  /**
   * Who asked each person who joined (accepted requests), for the admin's view of
   * "this manager's team" and for the manager's name on each team card. Anyone on
   * the project can see it.
   */
  async listAccepted(user: AuthUser, projectId: string) {
    await this.access.assertProject(user, projectId);
    const rows = (await this.inviteModel
      .find({ project: projectId, status: InviteStatus.ACCEPTED })
      .sort({ decidedAt: 1 })
      .select('invitee invitedBy')
      .lean()
      .exec()) as unknown as Array<{ invitee?: unknown; invitedBy?: unknown }>;
    return rows.map((r) => ({ invitee: String(r.invitee), invitedBy: String(r.invitedBy) }));
  }

  /** The requests waiting for this person, with the project and who sent them. */
  async listMine(user: AuthUser) {
    return this.inviteModel
      .find({ invitee: user.userId, status: InviteStatus.PENDING })
      .sort({ createdAt: -1 })
      .populate('project', 'name')
      .populate('invitedBy', 'name email')
      .lean()
      .exec();
  }

  /** The invited person accepts or declines. Accepting puts them on the team. */
  async decide(user: AuthUser, id: string, accept: boolean) {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid request id');
    const invite = await this.inviteModel.findById(id);
    if (!invite) throw new NotFoundException('Request not found');
    if (String(invite.invitee) !== user.userId) {
      throw new ForbiddenException('This request was not sent to you.');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('This request has already been answered.');
    }

    const projectId = String(invite.project);
    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('name')
      .lean()
      .exec()) as unknown as { name?: string } | null;

    if (accept) {
      if (!project) throw new NotFoundException('This project no longer exists.');
      // Ids may be stored as ObjectIds or as plain text, so add the ObjectId only once.
      await this.connection.model('Project').updateOne(
        { _id: projectId },
        { $addToSet: { members: new Types.ObjectId(user.userId) } },
      );
    }

    invite.status = accept ? InviteStatus.ACCEPTED : InviteStatus.DECLINED;
    invite.decidedAt = new Date();
    await invite.save();

    await this.notifications.notify([String(invite.invitedBy)], {
      kind: 'team_invite_decided',
      text: `${await this.nameOf(user.userId)} ${accept ? 'accepted' : 'declined'} your request to join “${project?.name ?? ''}”`,
      detail: '',
      link: `/projects/${projectId}/team`,
    });
    return invite;
  }

  /** A manager (of the project) or an admin withdraws a request that is still waiting. */
  async cancel(user: AuthUser, id: string) {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid request id');
    if (user.role !== UserRole.MANAGER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a manager or an admin can withdraw a request.');
    }
    const invite = await this.inviteModel.findById(id);
    if (!invite) throw new NotFoundException('Request not found');
    await this.access.assertProject(user, String(invite.project));
    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('This request has already been answered.');
    }
    await invite.deleteOne();
    return { deleted: true };
  }

  private async nameOf(userId: string): Promise<string> {
    const person = (await this.connection
      .model('User')
      .findById(userId)
      .select('name')
      .lean()
      .exec()) as unknown as { name?: string } | null;
    return person?.name ?? 'Someone';
  }
}
