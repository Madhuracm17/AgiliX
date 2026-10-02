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

/** Day-by-day points: used for both the burndown and the burnup chart. */
export interface SprintSeries {
  sprint: ReportSprint;
  startScope: number;
  totalScope: number;
  completedPoints: number;
  remainingPoints: number;
  days: SeriesDay[];
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
  }[];
  time: { totalSeconds: number };
}

export const getBurndown = (sprintId: string) =>
  api<SprintSeries>(`/reports/scrum/burndown/${sprintId}`);

export const getVelocity = (projectId: string) =>
  api<VelocityReport>(`/reports/scrum/velocity/${projectId}`);

export const getSprintReport = (sprintId: string) =>
  api<SprintReport>(`/reports/scrum/sprint-report/${sprintId}`);

export const getMyReport = (projectId: string) =>
  api<MyReport>(`/reports/scrum/my/${projectId}`);
