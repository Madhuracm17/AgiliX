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

    return new this.timeEntryModel({
      task: taskId,
      project: projectId,
      user: userId,
      startTime: new Date(),
    }).save();
  }

  async stop(id: string, userId: string) {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid time entry id');
    const entry = await this.timeEntryModel.findById(id);
    if (!entry) throw new NotFoundException('Time entry not found');
    if (String(entry.user) !== userId) {
      throw new ForbiddenException('You can only stop your own timer.');
    }
    if (entry.endTime) {
      throw new BadRequestException('This timer is already stopped');
    }

    entry.endTime = new Date();
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