import { api } from "./client";

export type SprintStatus = "planned" | "active" | "completed";

export interface Sprint {
  _id: string;
  name: string;
  project: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  teamVelocity: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateSprintData {
  name: string;
  project: string;
  startDate: string;
  endDate: string;
}

export function getSprints(projectId: string) {
  return api<Sprint[]>(`/sprints?project=${projectId}`);
}

export function getSprint(id: string) {
  return api<Sprint>(`/sprints/${id}`);
}

export function createSprint(data: CreateSprintData) {
  return api<Sprint>("/sprints", {
    method: "POST",
    body: JSON.stringify(data),
  });
}