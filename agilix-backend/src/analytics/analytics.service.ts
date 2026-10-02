import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
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
    // Anyone who came back as a bare id (no name) is looked up here, so every
    // entry has a name and email. People who no longer exist are skipped.
    const candidates: any[] = [project.owner, ...(project.members as any[])].filter(Boolean);
    const unresolved = candidates
      .filter((c) => !c.name)
      .map((c) => String(c._id ?? c))
      .filter((id) => isValidObjectId(id))
      .map((id) => new Types.ObjectId(id));
    const looked = new Map<string, any>();
    if (unresolved.length > 0) {
      const users: any[] = await this.projectModel.db
        .model('User')
        .find({ _id: { $in: unresolved } })
        .select('name email')
        .lean()
        .exec();
      for (const u of users) looked.set(String(u._id), u);
    }

    const memberMap = new Map<string, any>();
    for (const c of candidates) {
      const person = c.name ? c : looked.get(String(c._id ?? c));
      if (person) memberMap.set(String(person._id), person);
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