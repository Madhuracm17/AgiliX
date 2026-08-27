import { api } from "./client";
import type { User } from "./users";

export interface Project {
  _id: string;
  name: string;
  description?: string;
  owner: User;
  members: User[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectData {
  name: string;
  description?: string;
  owner: string;
  members?: string[];
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

export function addProjectMember(projectId: string, userId: string) {
  return api<Project>(`/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
  });
}