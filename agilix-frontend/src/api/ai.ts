import { api } from "./client";

export type RiskLevel = "green" | "yellow" | "red";

export interface SprintRisk {
  risk: RiskLevel;
  reasoning: string;
  completionForecastPercent: number;
}

export function getSprintRisk(sprintId: string) {
  return api<SprintRisk>(`/ai/sprint-risk/${sprintId}`);
}