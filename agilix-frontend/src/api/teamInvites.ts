import { api } from "./client";

/** A request waiting for the logged-in developer or tester. */
export interface MyInvite {
  _id: string;
  project: { _id: string; name: string } | null;
  invitedBy: { _id: string; name: string; email?: string } | null;
  createdAt: string;
}

/** A request a manager sent that has not been answered yet. */
export interface ProjectInvite {
  _id: string;
  invitee: { _id: string; name: string; email: string; role: string } | null;
  invitedBy: { _id: string; name: string } | null;
  createdAt: string;
}

/** Who asked each person who joined a project: person id -> manager id. */
export interface JoinedInvite {
  invitee: string;
  invitedBy: string;
}

export const getJoinedInvites = (projectId: string) =>
  api<JoinedInvite[]>(`/team-invites/accepted?project=${projectId}`);

export const getMyInvites = () => api<MyInvite[]>("/team-invites/mine");

export const getProjectInvites = (projectId: string) =>
  api<ProjectInvite[]>(`/team-invites?project=${projectId}`);

export const sendInvite = (projectId: string, userId: string) =>
  api<unknown>(`/team-invites/project/${projectId}`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });

export const acceptInvite = (id: string) =>
  api<unknown>(`/team-invites/${id}/accept`, { method: "PATCH" });

export const declineInvite = (id: string) =>
  api<unknown>(`/team-invites/${id}/decline`, { method: "PATCH" });

export const cancelInvite = (id: string) =>
  api<unknown>(`/team-invites/${id}`, { method: "DELETE" });
