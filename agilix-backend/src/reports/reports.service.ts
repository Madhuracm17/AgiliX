import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';
import { Sprint, SprintDocument, SprintStatus } from '../sprints/schemas/sprint.schema';
import { TimeEntry, TimeEntryDocument } from '../time-entries/schemas/time-entry.schema';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest sprint chart we draw (days). Keeps the response small. */
const MAX_DAYS = 60;

/** One task as the reports see it, whether it comes from the live data or a sprint snapshot. */
export interface ReportTask {
  id: string;
  title: string;
  status: string;
  points: number;
  assignee: string | null;
  addedAt: Date | null;
  doneAt: Date | null;
}

export interface SeriesDay {
  date: string;
  /** Straight line from the starting scope to zero. */
  ideal: number;
  /** Scope (all points in the sprint) at the end of that day. */
  scope: number;
  /** null for days that have not happened yet. */
  completed: number | null;
  remaining: number | null;
}

const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Start of the UTC day. */
const dayStart = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Sprint.name) private sprintModel: Model<SprintDocument>,
    @InjectModel(TimeEntry.name) private timeEntryModel: Model<TimeEntryDocument>,
  ) {}

  private async loadSprint(sprintId: string): Promise<SprintDocument> {
    if (!OBJECT_ID_PATTERN.test(sprintId ?? '')) {
      throw new BadRequestException('Invalid sprint id');
    }
    const sprint = await this.sprintModel.findById(sprintId);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  /**
   * The tasks of a sprint. A completed sprint reads the copy saved when it was
   * completed (its unfinished tasks have moved on since). An active or planned
   * sprint reads the live tasks. Task ids are matched as text and as ObjectId
   * because the app stores both forms.
   */
  private async tasksOf(sprint: SprintDocument): Promise<ReportTask[]> {
    if (sprint.status === SprintStatus.COMPLETED && sprint.snapshot?.length) {
      return sprint.snapshot.map((item: any) => ({
        id: String(item.taskId),
        title: String(item.title ?? ''),
        status: String(item.status ?? ''),
        points: Number(item.storyPoints) || 0,
        assignee: item.assignee ? String(item.assignee) : null,
        addedAt: asDate(item.addedAt),
        doneAt: asDate(item.doneAt),
      }));
    }

    const rows = await this.taskModel.collection
      .find({ sprint: { $in: [sprint._id, String(sprint._id)] } })
      .toArray();
    return rows.map((row: any) => ({
      id: String(row._id),
      title: String(row.title ?? ''),
      status: String(row.status ?? ''),
      points: Number(row.storyPoints) || 0,
      assignee: row.assignee ? String(row.assignee) : null,
      addedAt: asDate(row.addedToSprintAt) ?? asDate(row.createdAt),
      doneAt:
        row.status === TaskStatus.DONE
          ? (asDate(row.completedAt) ?? asDate(row.updatedAt))
          : null,
    }));
  }

  /** The day the sprint really began (falls back to its planned start). */
  private startOf(sprint: SprintDocument): Date {
    return dayStart(asDate(sprint.startedAt) ?? new Date(sprint.startDate));
  }

  /**
   * Day-by-day scope and completed points. Used by both the burndown
   * (remaining vs ideal) and the burnup (scope vs completed) charts.
   */
  async getSeries(sprintId: string) {
    const sprint = await this.loadSprint(sprintId);
    const tasks = await this.tasksOf(sprint);

    const start = this.startOf(sprint);
    const plannedEnd = dayStart(new Date(sprint.endDate));
    const end = plannedEnd.getTime() >= start.getTime() ? plannedEnd : start;
    const dayCount = Math.min(MAX_DAYS, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);

    // Where the actual line stops: today, or the day the sprint was completed.
    const lastActual = dayStart(asDate(sprint.completedAt) ?? new Date()).getTime();

    // Tasks with no recorded date count as part of the sprint from its first day.
    const addedBy = (task: ReportTask, endOfDay: number) =>
      (task.addedAt ? task.addedAt.getTime() : start.getTime()) <= endOfDay;

    const startScope = tasks
      .filter((t) => addedBy(t, start.getTime() + DAY_MS - 1))
      .reduce((sum, t) => sum + t.points, 0);

    const days: SeriesDay[] = [];
    for (let i = 0; i < dayCount; i++) {
      const dayMs = start.getTime() + i * DAY_MS;
      const endOfDay = dayMs + DAY_MS - 1;
      const scope = tasks.filter((t) => addedBy(t, endOfDay)).reduce((sum, t) => sum + t.points, 0);
      const completed = tasks
        .filter((t) => t.doneAt && t.doneAt.getTime() <= endOfDay)
        .reduce((sum, t) => sum + t.points, 0);
      const happened = dayMs <= lastActual;
      days.push({
        date: isoDay(new Date(dayMs)),
        ideal:
          dayCount > 1
            ? Math.round(startScope * (1 - i / (dayCount - 1)) * 10) / 10
            : 0,
        scope,
        completed: happened ? completed : null,
        remaining: happened ? Math.max(0, scope - completed) : null,
      });
    }

    const totalScope = tasks.reduce((sum, t) => sum + t.points, 0);
    const totalDone = tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + t.points, 0);

    return {
      sprint: this.describe(sprint),
      startScope,
      totalScope,
      completedPoints: totalDone,
      remainingPoints: Math.max(0, totalScope - totalDone),
      days,
    };
  }

  /** Committed vs completed points for every completed sprint, oldest first. */
  async getVelocity(projectId: string) {
    if (!OBJECT_ID_PATTERN.test(projectId ?? '')) {
      throw new BadRequestException('Invalid project id');
    }
    const sprints = await this.sprintModel
      .find({ project: projectId, status: SprintStatus.COMPLETED })
      .sort({ completedAt: 1 })
      .exec();

    const items = sprints.map((s) => ({
      sprintId: String(s._id),
      name: s.name,
      committed: s.committedStoryPoints ?? 0,
      completed: s.completedStoryPoints ?? 0,
      completedAt: s.completedAt,
    }));

    const recent = items.slice(-3);
    const average = recent.length
      ? Math.round((recent.reduce((sum, s) => sum + s.completed, 0) / recent.length) * 10) / 10
      : 0;

    return { sprints: items, averageVelocity: average };
  }

  /** Committed and completed points, completed and unfinished tasks, and scope changes. */
  async getSprintReport(sprintId: string) {
    const sprint = await this.loadSprint(sprintId);
    const tasks = await this.tasksOf(sprint);
    const start = this.startOf(sprint);
    const endOfStartDay = start.getTime() + DAY_MS - 1;

    const done = tasks.filter((t) => t.status === TaskStatus.DONE);
    const unfinished = tasks.filter((t) => t.status !== TaskStatus.DONE);
    const sum = (list: ReportTask[]) => list.reduce((total, t) => total + t.points, 0);

    // A task added after the first day of the sprint is a scope change.
    const scopeChanges =
      sprint.status === SprintStatus.PLANNED
        ? []
        : tasks
            .filter((t) => t.addedAt && t.addedAt.getTime() > endOfStartDay)
            .map((t) => ({ title: t.title, points: t.points, addedAt: t.addedAt }));

    const committed = sum(tasks.filter((t) => !t.addedAt || t.addedAt.getTime() <= endOfStartDay));
    const shape = (list: ReportTask[]) =>
      list.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        points: t.points,
        doneAt: t.doneAt,
      }));

    return {
      sprint: this.describe(sprint),
      committedPoints: committed,
      totalScopePoints: sum(tasks),
      completedPoints: sum(done),
      completedTasks: shape(done),
      incompleteTasks: shape(unfinished),
      scopeChanges,
    };
  }

  /** One person's own tasks, progress in the active sprint and tracked time. */
  async getMyReport(projectId: string, userId: string) {
    if (!OBJECT_ID_PATTERN.test(projectId ?? '')) {
      throw new BadRequestException('Invalid project id');
    }

    const projectKey = { $in: [new Types.ObjectId(projectId), projectId] };
    const [rows, sprints, entries] = await Promise.all([
      this.taskModel.collection.find({ project: projectKey }).toArray(),
      this.sprintModel.find({ project: projectId }).exec(),
      this.timeEntryModel
        .find({ project: projectId, user: userId, endTime: { $ne: null } })
        .exec(),
    ]);
    const mine = rows.filter((row: any) => row.assignee && String(row.assignee) === userId);

    const active = sprints.find((s) => s.status === SprintStatus.ACTIVE) ?? null;
    const sprintName = (task: any) =>
      sprints.find((s) => task.sprint && String(s._id) === String(task.sprint))?.name ?? null;

    const secondsByTask = new Map<string, number>();
    for (const entry of entries) {
      const key = String(entry.task);
      secondsByTask.set(key, (secondsByTask.get(key) ?? 0) + (entry.durationSeconds || 0));
    }

    const points = (task: any) => Number(task.storyPoints) || 0;
    const inActive = (task: any) =>
      !!active && !!task.sprint && String(task.sprint) === String(active._id);
    const activeMine = mine.filter(inActive);

    return {
      activeSprint: active ? this.describe(active) : null,
      progress: {
        assignedTasks: activeMine.length,
        doneTasks: activeMine.filter((t: any) => t.status === TaskStatus.DONE).length,
        assignedPoints: activeMine.reduce((s: number, t: any) => s + points(t), 0),
        donePoints: activeMine
          .filter((t: any) => t.status === TaskStatus.DONE)
          .reduce((s: number, t: any) => s + points(t), 0),
      },
      totals: {
        tasks: mine.length,
        done: mine.filter((t: any) => t.status === TaskStatus.DONE).length,
        inProgress: mine.filter(
          (t: any) => t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.REVIEW,
        ).length,
      },
      tasks: mine.map((t: any) => ({
        id: String(t._id),
        title: String(t.title ?? ''),
        status: String(t.status ?? ''),
        priority: String(t.priority ?? 'medium'),
        points: points(t),
        sprint: sprintName(t),
        seconds: secondsByTask.get(String(t._id)) ?? 0,
      })),
      time: {
        totalSeconds: entries.reduce((s, e) => s + (e.durationSeconds || 0), 0),
      },
    };
  }

  private describe(sprint: SprintDocument) {
    return {
      _id: String(sprint._id),
      name: sprint.name,
      goal: sprint.goal ?? '',
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      startedAt: sprint.startedAt,
      completedAt: sprint.completedAt,
    };
  }
}
