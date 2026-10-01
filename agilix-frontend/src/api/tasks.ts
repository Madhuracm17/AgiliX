import { api } from "./client";
import type { User } from "./users";

export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskType =
  | "frontend"
  | "backend"
  | "database"
  | "feature"
  | "bug"
  | "security";

/** Task types in the order they appear in dropdowns, with display labels. */
export const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "database", label: "Database" },
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "security", label: "Security" },
];

export interface Task {
  _id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: string;
  sprint?: string | null;
  assignee?: User | null;
  storyPoints?: number;
  type?: TaskType | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTaskData {
  title: string;
  description?: string;
  project: string;
  priority?: TaskPriority;
  assignee?: string;
  storyPoints?: number;
  type?: TaskType;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  sprint?: string | null;
  assignee?: string | null;
  storyPoints?: number;
  type?: TaskType;
}

export interface SprintStats {
  total: number;
  done: number;
  inProgress: number;
  /** Missing when talking to an older backend. */
  review?: number;
  todo: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
}

export function getTasks(projectId: string) {
  return api<Task[]>(`/tasks?project=${projectId}`);
}

export function getBacklogTasks(projectId: string) {
  return api<Task[]>(`/tasks/backlog?project=${projectId}`);
}

export function getSprintTasks(sprintId: string) {
  return api<Task[]>(`/tasks/sprint/${sprintId}`);
}

export function getSprintStats(sprintId: string) {
  return api<SprintStats>(`/tasks/sprint/${sprintId}/stats`);
}

export function createTask(data: CreateTaskData) {
  return api<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTask(id: string, data: UpdateTaskData) {
  return api<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function addTaskToSprint(taskId: string, sprintId: string) {
  return api<Task>(`/tasks/${taskId}/sprint/${sprintId}`, {
    method: "PATCH",
  });
}