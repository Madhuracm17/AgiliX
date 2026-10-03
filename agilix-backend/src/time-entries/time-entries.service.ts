import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { TimeEntry, TimeEntryDocument } from './schemas/time-entry.schema';

@Injectable()
export class TimeEntriesService {
  constructor(
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
  ) {}

  /** The time is always saved for `userId`, the person who is logged in. */
  async start(taskId: string, projectId: string, userId: string) {
    // Only one running timer per user per task at a time.
    const running = await this.timeEntryModel.findOne({
      task: taskId,
      user: userId,
      endTime: null,
    });

    if (running) {
      throw new BadRequestException(
        'A timer is already running for this task and user',
      );
    }

    // A person can only work on one task at a time: starting this timer pauses
    // any other timer of theirs that is still running (in any project).
    const paused = await this.pauseOtherTimers(userId);

    const saved = await new this.timeEntryModel({
      task: taskId,
      project: projectId,
      user: userId,
      startTime: new Date(),
    }).save();

    // `pausedTasks` tells the web app which timers were paused, so it can say so.
    return Object.assign(saved.toObject(), { pausedTasks: paused });
  }

  /** Stops every running timer of this person. Returns the tasks they were on. */
  async pauseOtherTimers(userId: string): Promise<{ taskId: string; title: string }[]> {
    const running = await this.timeEntryModel
      .find({ user: userId, endTime: null })
      .populate('task', 'title')
      .exec();

    const now = new Date();
    const paused: { taskId: string; title: string }[] = [];
    for (const entry of running) {
      entry.endTime = now;
      entry.durationSeconds = Math.max(
        0,
        Math.round((now.getTime() - entry.startTime.getTime()) / 1000),
      );
      await entry.save();
      const task = entry.task as unknown as { _id?: unknown; title?: string } | null;
      paused.push({ taskId: String(task?._id ?? entry.task), title: task?.title ?? 'another task' });
    }
    return paused;
  }

  /**
   * `endedAt` (optional) is when the person was last active. It is only used if it
   * falls between the start of the timer and now, so it can never lengthen the time.
   */
  async stop(id: string, userId: string, endedAt?: string) {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid time entry id');
    const entry = await this.timeEntryModel.findById(id);
    if (!entry) throw new NotFoundException('Time entry not found');
    if (String(entry.user) !== userId) {
      throw new ForbiddenException('You can only stop your own timer.');
    }
    if (entry.endTime) {
      throw new BadRequestException('This timer is already stopped');
    }

    const now = new Date();
    const requested = endedAt ? new Date(endedAt) : null;
    const usable =
      requested !== null &&
      !Number.isNaN(requested.getTime()) &&
      requested.getTime() >= entry.startTime.getTime() &&
      requested.getTime() <= now.getTime();
    entry.endTime = usable ? (requested as Date) : now;
    entry.durationSeconds = Math.round(
      (entry.endTime.getTime() - entry.startTime.getTime()) / 1000,
    );

    return entry.save();
  }

  findForTask(taskId: string) {
    return this.timeEntryModel
      .find({ task: taskId })
      .populate('user', 'name')
      .sort({ startTime: -1 })
      .exec();
  }

  findActiveForTask(taskId: string, userId: string) {
    return this.timeEntryModel
      .findOne({ task: taskId, user: userId, endTime: null })
      .exec();
  }

  async getTaskTotal(taskId: string) {
    const entries = await this.timeEntryModel
      .find({ task: taskId, endTime: { $ne: null } })
      .exec();
    const totalSeconds = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
    return { totalSeconds };
  }

  // Used by the future productivity/workload reports (next phase).
  findForProject(projectId: string) {
    return this.timeEntryModel
      .find({ project: projectId, endTime: { $ne: null } })
      .populate('user', 'name')
      .populate('task', 'title')
      .exec();
  }
}