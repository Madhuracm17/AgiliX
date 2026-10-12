import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../tasks/schemas/task.schema';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The time ranges the page offers. Anything else falls back to the default. */
export const KANBAN_REPORT_RANGES = [14, 30, 90] as const;
const DEFAULT_DAYS = 30;

/** The three Kanban columns. A task in Review (Scrum only) counts as In Progress. */
type Column = 'todo' | 'inProgress' | 'done';

const columnOf = (status: string | undefined): Column =>
  status === TaskStatus.DONE ? 'done' : status === TaskStatus.TODO || !status ? 'todo' : 'inProgress';

/** One moment a task entered a column. */
interface Move {
  at: number;
  column: Column;
}

interface TaskTimeline {
  id: string;
  title: string;
  createdAt: number;
  moves: Move[];
  /** First time it entered In Progress, if known. */
  startedAt: number | null;
  /** When it last reached Done, if it is Done now. */
  doneAt: number | null;
  /** Older task with no recorded moves: its dates are worked out from what it has. */
  estimated: boolean;
}

export interface CfdDay {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

export interface ThroughputWeek {
  /** Monday of the week (UTC), "YYYY-MM-DD". */
  weekStart: string;
  finished: number;
}

export interface DurationStats {
  /** How many finished tasks the numbers are based on. */
  count: number;
  /** In days, one decimal. null when there is nothing to measure. */
  averageDays: number | null;
  medianDays: number | null;
}

export interface FinishedTask {
  id: string;
  title: string;
  finishedAt: string;
  leadDays: number;
  /** null when the task never went through In Progress (or an older task without a start). */
  cycleDays: number | null;
}

export interface KanbanReport {
  days: number;
  from: string;
  to: string;
  cumulativeFlow: CfdDay[];
  throughput: ThroughputWeek[];
  leadTime: DurationStats;
  cycleTime: DurationStats;
  /** Finished in the range but without a known start, so left out of cycle time. */
  finishedWithoutStart: number;
  recentlyFinished: FinishedTask[];
  /** Older tasks with no recorded moves, whose dates are estimated. */
  estimatedTasks: number;
}

const time = (value: unknown): number | null => {
  if (!value) return null;
  const ms = new Date(value as string).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const dayStart = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Monday 00:00 UTC of the week containing `ms`. */
const weekStart = (ms: number) => {
  const start = dayStart(ms);
  const weekday = (new Date(start).getUTCDay() + 6) % 7; // Monday = 0
  return start - weekday * DAY_MS;
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toDays = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;

function stats(durations: number[]): DurationStats {
  if (durations.length === 0) return { count: 0, averageDays: null, medianDays: null };
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const average = sorted.reduce((sum, d) => sum + d, 0) / sorted.length;
  return { count: sorted.length, averageDays: toDays(average), medianDays: toDays(median) };
}

/**
 * Kanban reports: cumulative flow, throughput, lead time and cycle time.
 *
 * - Lead time: created → Done (how long the requester waits).
 * - Cycle time: first In Progress → Done (how long the work itself takes).
 * - Throughput: tasks finished per week.
 * - Cumulative flow: how many tasks sat in each column at the end of each day.
 *
 * Every column change is stored on the task (statusHistory). Older tasks have
 * none, so their timeline is pieced together from createdAt, startedAt and
 * completedAt, and the report says how many tasks that applies to.
 */
@Injectable()
export class KanbanReportsService {
  constructor(@InjectModel(Task.name) private taskModel: Model<TaskDocument>) {}

  async getReport(projectId: string, daysParam?: string): Promise<KanbanReport> {
    if (!OBJECT_ID_PATTERN.test(projectId ?? '')) {
      throw new BadRequestException('Invalid project id');
    }
    const asked = Number(daysParam);
    const days = (KANBAN_REPORT_RANGES as readonly number[]).includes(asked) ? asked : DEFAULT_DAYS;

    const now = Date.now();
    const today = dayStart(now);
    const from = today - (days - 1) * DAY_MS;

    // Project ids may be stored as ObjectIds or as plain text, so both are matched.
    const raw = await this.taskModel
      .find({ project: { $in: [new Types.ObjectId(projectId), projectId] } } as never)
      .select('title status createdAt updatedAt startedAt completedAt statusHistory')
      .lean()
      .exec();

    const timelines = raw
      .map((task) => this.timelineOf(task as unknown as Record<string, unknown>, now))
      .filter((t): t is TaskTimeline => t !== null);

    // Cumulative flow: the column of every existing task at the end of each day.
    const cumulativeFlow: CfdDay[] = [];
    for (let day = from; day <= today; day += DAY_MS) {
      const end = Math.min(day + DAY_MS - 1, now);
      const counts = { todo: 0, inProgress: 0, done: 0 };
      for (const t of timelines) {
        const column = this.columnAt(t, end);
        if (column) counts[column] += 1;
      }
      cumulativeFlow.push({ date: isoDay(day), ...counts });
    }

    // Throughput: finished tasks per week, for every week the range touches.
    const throughput: ThroughputWeek[] = [];
    for (let week = weekStart(from); week <= today; week += 7 * DAY_MS) {
      const finished = timelines.filter(
        (t) => t.doneAt !== null && t.doneAt >= week && t.doneAt < week + 7 * DAY_MS,
      ).length;
      throughput.push({ weekStart: isoDay(week), finished });
    }

    // Lead and cycle time of the tasks finished in the range.
    const finished = timelines
      .filter((t) => t.doneAt !== null && t.doneAt >= from)
      .sort((a, b) => (b.doneAt as number) - (a.doneAt as number));

    const leadTimes = finished.map((t) => (t.doneAt as number) - t.createdAt);
    const withStart = finished.filter((t) => t.startedAt !== null && t.startedAt <= (t.doneAt as number));
    const cycleTimes = withStart.map((t) => (t.doneAt as number) - (t.startedAt as number));

    return {
      days,
      from: isoDay(from),
      to: isoDay(today),
      cumulativeFlow,
      throughput,
      leadTime: stats(leadTimes),
      cycleTime: stats(cycleTimes),
      finishedWithoutStart: finished.length - withStart.length,
      recentlyFinished: finished.slice(0, 8).map((t) => ({
        id: t.id,
        title: t.title,
        finishedAt: new Date(t.doneAt as number).toISOString(),
        leadDays: toDays((t.doneAt as number) - t.createdAt),
        cycleDays:
          t.startedAt !== null && t.startedAt <= (t.doneAt as number)
            ? toDays((t.doneAt as number) - t.startedAt)
            : null,
      })),
      estimatedTasks: timelines.filter((t) => t.estimated).length,
    };
  }

  /** The column a task was in at a moment, or null if it did not exist yet. */
  private columnAt(t: TaskTimeline, moment: number): Column | null {
    if (moment < t.createdAt) return null;
    let column: Column = 'todo';
    for (const move of t.moves) {
      if (move.at > moment) break;
      column = move.column;
    }
    return column;
  }

  private timelineOf(task: Record<string, unknown>, now: number): TaskTimeline | null {
    const createdAt = time(task.createdAt);
    if (createdAt === null) return null;

    const current = columnOf(task.status as string);
    const history = Array.isArray(task.statusHistory)
      ? (task.statusHistory as { status?: string; at?: unknown }[])
      : [];

    let moves: Move[] = history
      .map((h) => ({ at: time(h.at), column: columnOf(h.status) }))
      .filter((m): m is Move => m.at !== null)
      .sort((a, b) => a.at - b.at);

    let startedAt = time(task.startedAt);
    let estimated = false;

    if (moves.length === 0 && current !== 'todo') {
      // An older task: rebuild its moves from the dates it does have.
      estimated = true;
      const fallback = time(task.updatedAt) ?? now;
      const doneAt = current === 'done' ? (time(task.completedAt) ?? fallback) : null;
      if (startedAt !== null && (doneAt === null || startedAt <= doneAt)) {
        moves.push({ at: startedAt, column: 'inProgress' });
      } else if (current === 'inProgress') {
        moves.push({ at: fallback, column: 'inProgress' });
      }
      if (doneAt !== null) moves.push({ at: doneAt, column: 'done' });
      moves = moves.sort((a, b) => a.at - b.at);
    }

    // A move recorded before the task's own creation time cannot be right; clamp it.
    moves = moves.map((m) => (m.at < createdAt ? { ...m, at: createdAt } : m));

    if (startedAt === null) {
      startedAt = moves.find((m) => m.column === 'inProgress')?.at ?? null;
    }

    // Done now: when it last arrived there (a reopened task counts from its final finish).
    let doneAt: number | null = null;
    if (current === 'done') {
      for (const move of moves) if (move.column === 'done') doneAt = move.at;
      if (doneAt === null) doneAt = time(task.completedAt) ?? time(task.updatedAt);
    }

    return {
      id: String(task._id),
      title: String(task.title ?? ''),
      createdAt,
      moves,
      startedAt,
      doneAt,
      estimated,
    };
  }
}
