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
  /** Story points of the member's tasks, and the part that is Done. */
  storyPointsTotal: number;
  storyPointsCompleted: number;
}

/** How the active sprint is going compared with the time that has passed. */
export type SprintPace = 'on_track' | 'at_risk' | 'behind';

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
        storyPointsTotal: memberTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
        storyPointsCompleted: completed.reduce((sum, t) => sum + (t.storyPoints || 0), 0),
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

    const count = (status: TaskStatus) => tasks.filter((t) => t.status === status).length;
    const points = (list: typeof tasks) => list.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    return {
      totalTasks,
      doneTasks,
      completionRate: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
      totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
      todoTasks: count(TaskStatus.TODO),
      // "In progress" here includes tasks waiting in Review: both are work that is open.
      inProgressTasks: count(TaskStatus.IN_PROGRESS) + count(TaskStatus.REVIEW),
      totalStoryPoints: points(tasks),
      completedStoryPoints: points(tasks.filter((t) => t.status === TaskStatus.DONE)),
      sprintPace: await this.getSprintPace(objectId),
    };
  }

  /**
   * Compares the active sprint's finished share (story points, or task count when
   * nothing has points) with the share of its time that has gone by. Null when the
   * project has no active sprint (for example a Kanban project). This is plain
   * arithmetic, separate from the AI sprint risk.
   */
  private async getSprintPace(projectId: Types.ObjectId): Promise<SprintPace | null> {
    const sprint: any = await this.projectModel.db
      .model('Sprint')
      .findOne({ project: projectId, status: 'active' })
      .lean()
      .exec();
    if (!sprint) return null;

    const sprintTasks = await this.taskModel.find({ sprint: sprint._id }).exec();
    if (sprintTasks.length === 0) return null;

    const totalPoints = sprintTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const doneTasks = sprintTasks.filter((t) => t.status === TaskStatus.DONE);
    const finished =
      totalPoints > 0
        ? doneTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0) / totalPoints
        : doneTasks.length / sprintTasks.length;

    const start = new Date(sprint.startedAt ?? sprint.startDate).getTime();
    const end = new Date(sprint.endDate).getTime();
    const elapsed = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1;

    const gap = elapsed - finished;
    if (gap <= 0.15) return 'on_track';
    if (gap <= 0.3) return 'at_risk';
    return 'behind';
  }
}