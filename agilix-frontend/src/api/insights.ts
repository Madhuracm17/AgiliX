import { api } from "./client";
import type { CalendarLoad } from "./calendar";

/* AI team insights: AgiliX + GitHub (MCP) data, analysed by the LLM. Managers and admins. */

export type SourceStatus = "ok" | "not_linked" | "not_configured" | "error" | "not_connected";

export interface InsightSources {
  agilix: "ok";
  github: SourceStatus;
  calendar: SourceStatus;
}

export interface MemberSignals {
  userId: string;
  name: string;
  role: string;
  githubUsername: string | null;
  work: {
    hoursTracked: number;
    lateNightHours: number;
    weekendHours: number;
    activeDays: number;
    longestDayHours: number;
    longestStreakDays: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    inReview: number;
    openStoryPoints: number;
    ageingInProgress: number;
    doneInWindow: number;
    donePointsInWindow: number;
  };
  github: {
    commits: number;
    lateNightCommits: number;
    weekendCommits: number;
    lastCommitAt: string | null;
    commitDays: string[];
    prsOpened: number;
    prsMerged: number;
    openPrs: number;
    stalePrs: number;
    reviewsGiven: number;
  } | null;
  /** Google Calendar meeting load; null when the person has not connected a calendar. */
  calendar: CalendarLoad | null;
}

export interface MemberBurnoutRisk {
  userId: string;
  name: string;
  risk: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  recommendations: string[];
  signals: MemberSignals;
}

export interface BurnoutRiskReport {
  windowDays: number;
  generatedAt: string;
  sources: InsightSources;
  teamSummary: string;
  members: MemberBurnoutRisk[];
  notes: string[];
}

export interface SprintHealthReport {
  generatedAt: string;
  sources: InsightSources;
  status: "healthy" | "at_risk" | "critical";
  score: number;
  completionForecastPercent: number | null;
  summary: string;
  risks: string[];
  recommendations: string[];
  facts: {
    mode: "sprint" | "flow";
    sprint?: { name: string; elapsedPercent: number; remainingDays: number; storyPoints: { total: number; done: number }; tasks: { total: number; done: number } };
    flow?: { wip: number; wipLimit: number; throughputThisPeriod: number; throughputPreviousPeriod: number; medianCycleDays: number | null };
    ageingInProgress: number;
    github: { commits: number; prsMerged: number; reviews: number; stalePrs: number } | null;
    team?: Array<{ name: string; meetings: { hours: number; next7DaysHours: number; outOfOfficeDaysNext7: number } | null }>;
  };
  notes: string[];
}

export function getBurnoutRisk(projectId: string, days = 14, refresh = false) {
  return api<BurnoutRiskReport>(
    `/insights/${projectId}/burnout?days=${days}${refresh ? "&refresh=1" : ""}`,
  );
}

export function getSprintHealth(projectId: string, refresh = false) {
  return api<SprintHealthReport>(`/insights/${projectId}/sprint-health${refresh ? "?refresh=1" : ""}`);
}

export interface MemberStandup {
  userId: string;
  name: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  facts: {
    commits: { message: string; at: string }[];
    finished: string[];
    moved: { title: string; to: string; at: string }[];
  };
}

export interface StandupReport {
  sinceLabel: string;
  generatedAt: string;
  github: "ok" | "not_linked" | "not_configured" | "error";
  headline: string;
  members: MemberStandup[];
}

/** Every project member can read the standup. */
export function getStandup(projectId: string, refresh = false) {
  return api<StandupReport>(`/insights/${projectId}/standup${refresh ? "?refresh=1" : ""}`);
}
