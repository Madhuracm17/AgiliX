import { api } from "./client";

/* Comments on tasks (anyone on the project's team). */

export interface TaskComment {
  id: string;
  taskId: string;
  text: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
  /** The viewer may delete it (their own, or a manager / admin). */
  canDelete: boolean;
}

export const COMMENT_MAX_LENGTH = 2000;

export function getComments(taskId: string) {
  return api<TaskComment[]>(`/comments/task/${taskId}`);
}

export function addComment(taskId: string, text: string) {
  return api<TaskComment>(`/comments/task/${taskId}`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function deleteComment(id: string) {
  return api<{ deleted: true }>(`/comments/${id}`, { method: "DELETE" });
}

export function getCommentCounts(taskIds: string[]) {
  return api<Record<string, number>>(`/comments/counts?tasks=${taskIds.map(encodeURIComponent).join(",")}`);
}
