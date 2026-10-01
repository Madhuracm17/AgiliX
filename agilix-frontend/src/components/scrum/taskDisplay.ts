import { TASK_TYPES, type TaskStatus, type TaskType } from "../../api/tasks";

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