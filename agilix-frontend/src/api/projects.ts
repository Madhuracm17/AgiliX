import { api } from "./client";
import type { User } from "./users";

export type ProjectStatus = "active" | "on_hold" | "completed";

/** Words shown for each status. Older projects have no status and count as active. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

export interface Project {
  _id: string;
  name: string;
  description?: string;
  owner: User;
  members: User[];
  methodology?: "scrum" | "kanban";
  status?: ProjectStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectData {
  name: string;
  description?: string;
  /** The backend makes the logged-in admin the owner. */
  members?: string[];
  methodology?: "scrum" | "kanban";
}

export function getProjects() {
  return api<Project[]>("/projects");
}

export function getProject(id: string) {
  return api<Project>(`/projects/${id}`);
}

export function createProject(data: CreateProjectData) {
  return api<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function removeProjectMember(projectId: string, userId: string) {
  return api<Project>(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function addProjectMember(projectId: string, userId: string) {
  return api<Project>(`/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
  });
}

export interface UpdateProjectData {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

export function updateProject(id: string, data: UpdateProjectData) {
  return api<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Also deletes the project's tasks, sprints and time entries. */
export function deleteProject(id: string) {
  return api<{ deleted: boolean }>(`/projects/${id}`, { method: "DELETE" });
}
