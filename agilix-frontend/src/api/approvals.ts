import { api } from "./client";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  _id: string;
  project: string;
  type: "create_task" | "delete_task";
  status: ApprovalStatus;
  requestedBy?: { _id: string; name: string; role?: string } | null;
  /** For delete requests: the task it is about. */
  task?: string | null;
  taskTitle: string;
  /** Waiting delete requests (managers only): where the task is now. */
  taskLocation?: "backlog" | "current_sprint" | "other_sprint" | "missing";
  /** The active sprint's name, if the project has one. */
  activeSprintName?: string | null;
  createdAt?: string;
  decidedAt?: string | null;
}

/** Managers and admins get everyone's requests; others only their own. */
export function getApprovals(projectId: string) {
  return api<ApprovalRequest[]>(`/approvals?project=${projectId}`);
}

/** Where a manager puts a task: the backlog, or the current (active) sprint. */
export type PlaceAction = "backlog" | "sprint";

/**
 * Tasks that can no longer be asked about, whoever asked: a delete request is
 * waiting for a manager, or a manager already declined one.
 */
export function getDeleteRequestState(projectId: string) {
  return api<{ pending: string[]; declined: string[] }>(
    `/approvals/pending-deletes?project=${projectId}`,
  );
}

/** Approving a create request can say where the task goes; approving a delete request deletes it. */
export function approveRequest(id: string, action?: PlaceAction) {
  return api<ApprovalRequest>(`/approvals/${id}/approve`, {
    method: "PATCH",
    body: JSON.stringify(action ? { action } : {}),
  });
}

/** Rejecting a delete request can also move the task; otherwise it stays where it is. */
export function rejectRequest(id: string, action?: PlaceAction) {
  return api<ApprovalRequest>(`/approvals/${id}/reject`, {
    method: "PATCH",
    body: JSON.stringify(action ? { action } : {}),
  });
}
