import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TimeEntry, TimeEntryDocument } from './schemas/time-entry.schema';
import { StartTimerDto } from './dto/start-timer.dto';

@Injectable()
export class TimeEntriesService {
  constructor(
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
  ) {}

  async start(dto: StartTimerDto) {
    // Only one running timer per user per task at a time.
    const running = await this.timeEntryModel.findOne({
      task: dto.task,
      user: dto.user,
      endTime: null,
    });

    if (running) {
      throw new BadRequestException(
        'A timer is already running for this task and user',
      );
    }

    return new this.timeEntryModel({ ...dto, startTime: new Date() }).save();
  }

  async stop(id: string) {
    const entry = await this.timeEntryModel.findById(id);
    if (!entry) throw new NotFoundException('Time entry not found');
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