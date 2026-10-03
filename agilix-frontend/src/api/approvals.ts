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
  createdAt?: string;
  decidedAt?: string | null;
}

/** Managers and admins get everyone's requests; others only their own. */
export function getApprovals(projectId: string) {
  return api<ApprovalRequest[]>(`/approvals?project=${projectId}`);
}

export function approveRequest(id: string) {
  return api<ApprovalRequest>(`/approvals/${id}/approve`, { method: "PATCH" });
}

export function rejectRequest(id: string) {
  return api<ApprovalRequest>(`/approvals/${id}/reject`, { method: "PATCH" });
}
