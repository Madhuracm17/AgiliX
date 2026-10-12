import { api } from "./client";

export interface ReportSprint {
  _id: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "completed";
  startDate: string;
  endDate: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SeriesDay {
  date: string;
  ideal: number;
  scope: number;
  /** null for days that have not happened yet. */
  completed: number | null;
  remaining: number | null;
}

/** Day-by-day points for the burndown chart. */
export interface SprintSeries {
  sprint: ReportSprint;
  startScope: number;
  totalScope: number;
  completedPoints: number;
  remainingPoints: number;
  days: SeriesDay[];
}

/** Hours tracked per person in one sprint, against a limit (the "burnout" chart). */
export interface BurnoutPerson {
  userId: string;
  name: string;
  hours: number;
  openTasks: number;
  level: "ok" | "near" | "high";
  note: string | null;
}

export interface BurnoutReport {
  sprint: ReportSprint;
  sprintDays: number;
  weeklyLimitHours: number;
  limitHours: number;
  people: BurnoutPerson[];
}

export interface VelocityReport {
  sprints: {
    sprintId: string;
    name: string;
    committed: number;
    completed: number;
    completedAt: string | null;
  }[];
  averageVelocity: number;
}

export interface ReportTaskRow {
  id: string;
  title: string;
  status: string;
  points: number;
  doneAt: string | null;
}

export interface SprintReport {
  sprint: ReportSprint;
  committedPoints: number;
  totalScopePoints: number;
  completedPoints: number;
  completedTasks: ReportTaskRow[];
  incompleteTasks: ReportTaskRow[];
  scopeChanges: { title: string; points: number; addedAt: string | null }[];
}

export interface MyReport {
  activeSprint: ReportSprint | null;
  progress: {
    assignedTasks: number;
    doneTasks: number;
    assignedPoints: number;
    donePoints: number;
  };
  totals: { tasks: number; done: number; inProgress: number };
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    points: number;
    sprint: string | null;
    seconds: number;
    /** A tester's tasks include the ones they review. */
    kind?: "assigned" | "review" | "reviewed";
    done?: boolean;
  }[];
  time: { totalSeconds: number };
}

export const getBurndown = (sprintId: string) =>
  api<SprintSeries>(`/reports/scrum/burndown/${sprintId}`);

export const getVelocity = (projectId: string) =>
  api<VelocityReport>(`/reports/scrum/velocity/${projectId}`);

export const getSprintReport = (sprintId: string) =>
  api<SprintReport>(`/reports/scrum/sprint-report/${sprintId}`);

/** `userId` is for an admin looking at one developer's or tester's report. */
export const getMyReport = (projectId: string, userId?: string) =>
  api<MyReport>(`/reports/scrum/my/${projectId}${userId ? `?user=${userId}` : ""}`);

export const getBurnout = (sprintId: string) =>
  api<BurnoutReport>(`/reports/scrum/burnout/${sprintId}`);

/* ------------------------------- Kanban reports ------------------------------- */

export type KanbanReportRange = 14 | 30 | 90;

/** How many tasks sat in each column at the end of one day. */
export interface CfdDay {
  date: string;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
}

export interface ThroughputWeek {
  /** Monday of the week, "YYYY-MM-DD". */
  weekStart: string;
  finished: number;
}

export interface DurationStats {
  count: number;
  /** Days, one decimal; null when nothing finished in the range. */
  averageDays: number | null;
  medianDays: number | null;
}

export interface KanbanReport {
  days: number;
  from: string;
  to: string;
  cumulativeFlow: CfdDay[];
  throughput: ThroughputWeek[];
  /** Created → Done. */
  leadTime: DurationStats;
  /** First In Progress → Done. */
  cycleTime: DurationStats;
  finishedWithoutStart: number;
  recentlyFinished: {
    id: string;
    title: string;
    finishedAt: string;
    leadDays: number;
    cycleDays: number | null;
  }[];
  estimatedTasks: number;
}

export const getKanbanReport = (projectId: string, days: KanbanReportRange) =>
  api<KanbanReport>(`/reports/kanban/${projectId}?days=${days}`);
