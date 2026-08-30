import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import {
  TimeEntry,
  TimeEntryDocument,
} from '../time-entries/schemas/time-entry.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';

export interface MemberWorkload {
  user: { _id: string; name: string; email: string };
  tasksTotal: number;
  tasksCompleted: number;
  tasksInProgress: number;
  hoursWorked: number;
  completionRate: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
  ) {}

  async getWorkload(projectId: string): Promise<MemberWorkload[]> {
    const project = await this.projectModel
      .findById(projectId)
      .populate('owner', 'name email')
      .populate('members', 'name email');

    if (!project) throw new NotFoundException('Project not found');

    // Owner + members, de-duplicated, so someone who is both isn't listed twice.
    const memberMap = new Map<string, any>();
    if (project.owner) memberMap.set(String((project.owner as any)._id), project.owner);
    for (const member of project.members as any[]) {
      memberMap.set(String(member._id), member);
    }
    const members = Array.from(memberMap.values());

    const tasks = await this.taskModel.find({ project: projectId }).exec();
    const timeEntries = await this.timeEntryModel
      .find({ project: projectId, endTime: { $ne: null } })
      .exec();

    return members.map((member) => {
      const memberId = String(member._id);

      const memberTasks = tasks.filter(
        (t) => t.assignee && String(t.assignee) === memberId,
      );
      const completed = memberTasks.filter((t) => t.status === TaskStatus.DONE);
      const inProgress = memberTasks.filter(
        (t) => t.status === TaskStatus.IN_PROGRESS,
      );

      const memberSeconds = timeEntries
        .filter((e) => String(e.user) === memberId)
        .reduce((sum, e) => sum + e.durationSeconds, 0);

      return {
        user: { _id: memberId, name: member.name, email: member.email },
        tasksTotal: memberTasks.length,
        tasksCompleted: completed.length,
        tasksInProgress: inProgress.length,
        hoursWorked: Math.round((memberSeconds / 3600) * 10) / 10,
        completionRate: memberTasks.length
          ? Math.round((completed.length / memberTasks.length) * 100)
          : 0,
      };
    });
  }

  async getProjectSummary(projectId: string) {
    const objectId = new Types.ObjectId(projectId);

    const tasks = await this.taskModel.find({ project: objectId }).exec();
    const timeEntries = await this.timeEntryModel
      .find({ project: objectId, endTime: { $ne: null } })
      .exec();

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const totalSeconds = timeEntries.reduce((sum, e) => sum + e.durationSeconds, 0);

    return {
      totalTasks,
      doneTasks,
      completionRate: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
      totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
    };
  }
}