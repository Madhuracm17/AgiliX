import { TASK_TYPES, type TaskStatus, type TaskType } from "../../api/tasks";

/** Admins and managers may create, edit, start and complete sprints. */
export function canManageSprints(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** Review → Done is the tester's sign-off (also managers and admins). */
export function canMarkDone(role: string | undefined): boolean {
  return role === "tester" || role === "manager" || role === "admin";
}

/** Changing a task's priority or assignee after it exists: managers and admins. */
export function canEditTaskPlan(role: string | undefined): boolean {
  return role === "manager" || role === "admin";
}

/** Board columns of the Scrum Board, in order. */
export const SCRUM_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

/**
 * Sprint tasks only move forward, one step at a time:
 * To Do → In Progress → Review → Done. Returns null for Done.
 */
export function nextStatus(status: TaskStatus): TaskStatus | null {
  const index = SCRUM_COLUMNS.findIndex((c) => c.key === status);
  return index >= 0 && index < SCRUM_COLUMNS.length - 1
    ? SCRUM_COLUMNS[index + 1].key
    : null;
}

export function statusLabel(status: TaskStatus): string {
  return SCRUM_COLUMNS.find((c) => c.key === status)?.label ?? status;
}

export function typeLabel(type: TaskType | null | undefined): string {
  return TASK_TYPES.find((t) => t.value === type)?.label ?? "—";
}

interface SprintLike {
  _id: string;
  name: string;
  startDate: string;
  createdAt?: string;
}

/**
 * "Sprint 5 (login page)": the sprint's number (by start date, oldest =
 * Sprint 1) followed by its name. A sprint already named like "Sprint 5"
 * is shown as-is so it doesn't read "Sprint 5 (Sprint 5)".
 */
export function sprintLabel(sprint: SprintLike, allSprints: SprintLike[]): string {
  const name = sprint.name.trim();
  if (/^sprint\s*\d+$/i.test(name)) return name;

  const time = (s: SprintLike) => new Date(s.startDate).getTime();
  const ordered = [...allSprints].sort(
    (a, b) =>
      time(a) - time(b) ||
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime() ||
      a._id.localeCompare(b._id)
  );
  const number = ordered.findIndex((s) => s._id === sprint._id) + 1;
  return number > 0 ? `Sprint ${number} (${name})` : name;
}

/** Sprint lengths offered when creating a sprint. */
export const SPRINT_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6];

/** A Date as "YYYY-MM-DD" in the user's own time zone. */
function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The last day of a sprint that starts on `startDate` (YYYY-MM-DD) and lasts `weeks` weeks. */
export function endDateFor(startDate: string, weeks: number): string {
  const end = new Date(`${startDate}T00:00:00`);
  end.setDate(end.getDate() + weeks * 7 - 1);
  return toDateInput(end);
}

/** How many whole weeks (1 to 6) a sprint from `startDate` to `endDate` lasts, rounded to the nearest. */
export function weeksBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.min(6, Math.max(1, Math.round(days / 7)));
}

/**
 * Dates for a new sprint of `weeks` weeks. It starts the day after the last
 * planned/active sprint ends (so sprints line up one after another), or
 * today if there is none. A 2-week sprint starting Oct 2 ends Oct 15.
 */
export function nextSprintDates(
  sprints: { status: string; endDate: string }[],
  weeks: number
): { startDate: string; endDate: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = today;
  for (const sprint of sprints) {
    if (sprint.status === "completed") continue;
    const dayAfter = new Date(sprint.endDate);
    dayAfter.setHours(0, 0, 0, 0);
    dayAfter.setDate(dayAfter.getDate() + 1);
    if (dayAfter > start) start = dayAfter;
  }

  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7 - 1);
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

/** "Oct 2, 2026" */
export function formatLongDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function priorityLabel(priority: string): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/**
 * Compares two ids that may come back either as plain strings or as
 * populated objects ({ _id }) — older records store ids as text.
 */
export function sameId(a: unknown, b: unknown): boolean {
  const idOf = (v: unknown) =>
    v && typeof v === "object" && "_id" in v
      ? String((v as { _id: unknown })._id)
      : v == null
        ? ""
        : String(v);
  const left = idOf(a);
  return left !== "" && left === idOf(b);
}

/** Whole days from today until the end of the sprint's end date (never negative). */
export function daysLeft(endDate: string): number {
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  const diff = end.getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/** "just now", "5m ago", "2h ago", "3d ago", or a short date for older events. */
export function timeAgo(date: string | Date): string {
  const then = new Date(date);
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Up to two initials for an avatar circle. */
export function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

/** Morning / Afternoon / Evening, for the dashboard greeting. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/** Readable message from api()/fetch errors (Nest returns JSON bodies). */
export function readError(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  try {
    const body = JSON.parse(err.message) as { message?: unknown };
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    return typeof message === "string" && message ? message : fallback;
  } catch {
    return err.message;
  }
}
