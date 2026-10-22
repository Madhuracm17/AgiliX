import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';
import { quote, taskLink } from './activity-events';
import { ActivityService } from './activity.service';
import { Comment, CommentDocument } from './schemas/comment.schema';

export interface CommentView {
  id: string;
  taskId: string;
  text: string;
  author: { id: string; name: string; role: string };
  createdAt: Date;
  /** The viewer may delete it (their own comment, or a manager / admin). */
  canDelete: boolean;
}

const ADMIN_MESSAGE = 'Admins can view projects and reports only. Comments are written by the team.';
const MAX_COUNT_IDS = 300;

/**
 * Comments on tasks. Anyone on the project's team can read and write them;
 * authors (and managers / admins) can delete them. The task's assignee and the
 * people already in the conversation get a notification.
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger('Comments');

  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<CommentDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  async list(user: AuthUser, taskId: string): Promise<CommentView[]> {
    await this.access.assertTask(user, taskId);
    const docs = (await this.comments
      .find({ task: new Types.ObjectId(taskId) })
      .sort({ createdAt: 1 })
      .populate('author', 'name role')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; task: unknown; text: string; author: unknown; createdAt: Date }>;
    return docs.map((d) => this.view(d, user));
  }

  async create(user: AuthUser, taskId: string, rawText: string): Promise<CommentView> {
    if (user.role === UserRole.ADMIN) throw new ForbiddenException(ADMIN_MESSAGE);
    const { projectId, assignee } = await this.access.assertTask(user, taskId);
    const text = rawText.trim();
    if (!text) throw new BadRequestException('A comment cannot be empty.');

    const saved = await this.comments.create({
      task: new Types.ObjectId(taskId),
      project: new Types.ObjectId(projectId),
      author: new Types.ObjectId(user.userId),
      text,
    });

    const task = (await this.connection.model('Task').findById(taskId).select('title sprint').lean().exec()) as {
      title?: string;
      sprint?: unknown;
    } | null;
    const title = task?.title ?? '';
    await this.activity.record(user.userId, [
      { project: projectId, task: taskId, action: 'comment.added', text: `commented on ${quote(title)}` },
    ]);
    await this.notify(user, taskId, projectId, assignee, title, task?.sprint, text);

    const author = (await this.connection.model('User').findById(user.userId).select('name role').lean().exec()) as {
      _id: unknown;
      name?: string;
      role?: string;
    } | null;
    return this.view({ _id: saved._id, task: taskId, text, author, createdAt: (saved as unknown as { createdAt: Date }).createdAt }, user);
  }

  async remove(user: AuthUser, commentId: string): Promise<{ deleted: true }> {
    if (!isValidObjectId(commentId)) throw new NotFoundException('Comment not found');
    const comment = await this.comments.findById(commentId).select('task author').lean().exec();
    if (!comment) throw new NotFoundException('Comment not found');
    await this.access.assertTask(user, String(comment.task));
    const isPlanner = user.role === UserRole.MANAGER || user.role === UserRole.ADMIN;
    if (!isPlanner && String(comment.author) !== user.userId) {
      throw new ForbiddenException('You can only delete your own comments.');
    }
    await this.comments.deleteOne({ _id: comment._id }).exec();
    return { deleted: true };
  }

  /**
   * Comment counts for many tasks at once (the board asks for all its cards in
   * one request). Tasks the user may not see are left out.
   */
  async counts(user: AuthUser, taskIdsParam: string | undefined): Promise<Record<string, number>> {
    const ids = [...new Set((taskIdsParam ?? '').split(',').map((s) => s.trim()))]
      .filter((id) => isValidObjectId(id))
      .slice(0, MAX_COUNT_IDS);
    if (!ids.length) return {};

    const tasks = (await this.connection
      .model('Task')
      .find({ _id: { $in: ids } })
      .select('project')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; project: unknown }>;
    const allowedProjects = new Set<string>();
    for (const projectId of new Set(tasks.map((t) => String(t.project)))) {
      try {
        await this.access.assertProject(user, projectId);
        allowedProjects.add(projectId);
      } catch {
        // Not on that team: its tasks are left out.
      }
    }
    const visible = tasks.filter((t) => allowedProjects.has(String(t.project))).map((t) => String(t._id));

    const rows = (await this.comments
      .aggregate([
        { $match: { task: { $in: visible.map((id) => new Types.ObjectId(id)) } } },
        { $group: { _id: '$task', n: { $sum: 1 } } },
      ])
      .exec()) as Array<{ _id: unknown; n: number }>;
    const result: Record<string, number> = {};
    for (const id of visible) result[id] = 0;
    for (const row of rows) result[String(row._id)] = row.n;
    return result;
  }

  /** Tells the assignee and earlier commenters, never the author. Never throws. */
  private async notify(
    user: AuthUser,
    taskId: string,
    projectId: string,
    assignee: string | null,
    title: string,
    sprint: unknown,
    text: string,
  ) {
    try {
      const earlier = (await this.comments.distinct('author', { task: new Types.ObjectId(taskId) }).exec()) as unknown[];
      const recipients = [...new Set([assignee, ...earlier.map(String)])].filter(
        (id): id is string => !!id && id !== user.userId,
      );
      if (!recipients.length) return;

      const [author, project] = await Promise.all([
        this.connection.model('User').findById(user.userId).select('name').lean().exec() as Promise<{ name?: string } | null>,
        this.connection.model('Project').findById(projectId).select('methodology').lean().exec() as Promise<{
          methodology?: string;
        } | null>,
      ]);
      const link = taskLink({ _id: projectId, methodology: project?.methodology }, { _id: taskId, sprint });
      // Written straight to the bell's collection (NotificationsService is left unchanged).
      await this.connection.model('Notification').insertMany(
        recipients.map((id) => ({
          user: new Types.ObjectId(id),
          text: `${author?.name ?? 'Someone'} commented on ${quote(title)}`,
          detail: text.length > 140 ? `${text.slice(0, 137)}...` : text,
          link,
          kind: 'task_comment',
        })),
      );
    } catch (error) {
      this.logger.warn(`Comment notification not sent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private view(
    d: { _id: unknown; task: unknown; text: string; author: unknown; createdAt: Date },
    viewer: AuthUser,
  ): CommentView {
    const author = (d.author ?? {}) as { _id?: unknown; name?: string; role?: string };
    const authorId = author._id ? String(author._id) : String(d.author);
    const isPlanner = viewer.role === UserRole.MANAGER || viewer.role === UserRole.ADMIN;
    return {
      id: String(d._id),
      taskId: String(d.task),
      text: d.text,
      author: { id: authorId, name: author.name ?? 'Former member', role: author.role ?? '' },
      createdAt: d.createdAt,
      canDelete: isPlanner || authorId === viewer.userId,
    };
  }
}
