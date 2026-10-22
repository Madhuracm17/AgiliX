import { api } from "./client";

/* The project activity log. */

export interface ActivityEntry {
  id: string;
  /** e.g. task.moved, sprint.started, comment.added */
  action: string;
  /** What happened, without the person's name. */
  text: string;
  actor: { id: string; name: string };
  taskId: string | null;
  sprintId: string | null;
  at: string;
}

export function getProjectActivity(projectId: string, before?: string, limit = 50) {
  const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
  return api<ActivityEntry[]>(`/activity/project/${projectId}?${query.toString()}`);
}

export function getTaskActivity(taskId: string) {
  return api<ActivityEntry[]>(`/activity/task/${taskId}`);
}
