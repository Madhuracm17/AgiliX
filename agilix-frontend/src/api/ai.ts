import { api } from "./client";
import type { TaskPriority } from "./tasks";

export type RiskLevel = "green" | "yellow" | "red";

export interface SprintRisk {
  risk: RiskLevel;
  reasoning: string;
  completionForecastPercent: number;
}

export function getSprintRisk(sprintId: string) {
  return api<SprintRisk>(`/ai/sprint-risk/${sprintId}`);
}

// ---- AI Story Point Estimation ----

/** The only story-point values AgiliX accepts (must match the backend). */
export const STORY_POINT_SCALE = [0, 1, 2, 3, 5, 8, 13] as const;

export type StoryPointValue = (typeof STORY_POINT_SCALE)[number];

export interface StoryPointEstimateRequest {
  title: string;
  description?: string;
  priority?: TaskPriority;
  project: string;
  /** Set when re-estimating an existing task. */
  taskId?: string;
}

export interface StoryPointEstimate {
  storyPoints: StoryPointValue;
  reasoning: string;
}

/** Returns an AI suggestion only — it never modifies a task. */
export function estimateStoryPoints(data: StoryPointEstimateRequest) {
  return api<StoryPointEstimate>("/ai/story-points", {
    method: "POST",
    body: JSON.stringify(data),
  });
}