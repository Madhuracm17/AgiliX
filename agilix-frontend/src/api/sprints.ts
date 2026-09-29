import { api } from "./client";

export type SprintStatus = "planned" | "active" | "completed";

export interface Sprint {
  _id: string;
  name: string;
  project: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  committedStoryPoints?: number | null;
  completedStoryPoints?: number | null;
  teamVelocity: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateSprintData {
  name: string;
  project: string;
  goal?: string;
  startDate: string;
  endDate: string;
}

/** Fields that can be edited while a sprint is planned or active. */
export interface UpdateSprintData {
  name?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

export interface CompleteSprintResult {
  sprint: Sprint;
  /** How many unfinished tasks went back to the backlog. */
  movedToBacklog: number;
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

export function updateSprint(id: string, data: UpdateSprintData) {
  return api<Sprint>(`/sprints/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** planned → active (only one active sprint per project). */
export function startSprint(id: string) {
  return api<Sprint>(`/sprints/${id}/start`, { method: "PATCH" });
}

/** active → completed; unfinished tasks go back to the backlog. */
export function completeSprint(id: string) {
  return api<CompleteSprintResult>(`/sprints/${id}/complete`, { method: "PATCH" });
}