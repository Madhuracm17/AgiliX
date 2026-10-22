import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { ActivityDraft } from './activity-events';
import { Activity, ActivityDocument } from './schemas/activity.schema';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ActivityEntry {
  id: string;
  action: string;
  text: string;
  actor: { id: string; name: string };
  taskId: string | null;
  sprintId: string | null;
  at: Date;
}

/** Saves and reads the activity log. Saving never throws: the log must not undo the change it describes. */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger('Activity');

  constructor(
    @InjectModel(Activity.name) private readonly activity: Model<ActivityDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async record(actorId: string, drafts: ActivityDraft[]): Promise<void> {
    const valid = drafts.filter((d) => isValidObjectId(d.project));
    if (!valid.length || !isValidObjectId(actorId)) return;
    try {
      const actor = (await this.connection.model('User').findById(actorId).select('name').lean().exec()) as {
        name?: string;
      } | null;
      await this.activity.insertMany(
        valid.map((d) => ({
          project: new Types.ObjectId(d.project),
          actor: new Types.ObjectId(actorId),
          actorName: actor?.name ?? '',
          action: d.action,
          text: d.text,
          task: d.task && isValidObjectId(d.task) ? new Types.ObjectId(d.task) : null,
          sprint: d.sprint && isValidObjectId(d.sprint) ? new Types.ObjectId(d.sprint) : null,
        })),
      );
    } catch (error) {
      this.logger.warn(`Could not save activity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Newest first. `before` (an ISO date) pages back through older entries. */
  async forProject(projectId: string, limitParam?: string | number, before?: string): Promise<ActivityEntry[]> {
    const limit = Math.min(Math.max(Number(limitParam) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const filter: Record<string, unknown> = { project: new Types.ObjectId(projectId) };
    if (before) {
      const date = new Date(before);
      if (Number.isNaN(date.getTime())) throw new BadRequestException('"before" must be a date');
      filter.createdAt = { $lt: date };
    }
    return this.find(filter, limit);
  }

  /** A task's history, newest first. */
  forTask(taskId: string): Promise<ActivityEntry[]> {
    return this.find({ task: new Types.ObjectId(taskId) }, MAX_LIMIT);
  }

  private async find(filter: Record<string, unknown>, limit: number): Promise<ActivityEntry[]> {
    const docs = (await this.activity
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()) as unknown as Array<Activity & { _id: unknown; createdAt: Date }>;
    return docs.map((d) => ({
      id: String(d._id),
      action: d.action,
      text: d.text,
      actor: { id: String(d.actor), name: d.actorName },
      taskId: d.task ? String(d.task) : null,
      sprintId: d.sprint ? String(d.sprint) : null,
      at: d.createdAt,
    }));
  }
}
