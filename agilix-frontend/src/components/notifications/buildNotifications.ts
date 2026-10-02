import type { Task } from "../../api/tasks";
import type { Sprint } from "../../api/sprints";
import { canMarkDone, daysLeft, sameId, sprintLabel } from "../scrum/taskDisplay";

export interface ProjectData {
  project: { _id: string; name: string; methodology?: "scrum" | "kanban" };
  tasks: Task[];
  sprints: Sprint[];
}

export interface AppNotification {
  /** Stable id, used to remember what the person has already seen. */
  key: string;
  text: string;
  /** Project name shown under the text. */
  detail: string;
  /** Where clicking the notification goes. */
  link: string;
  /** When it happened (ISO date); sprint reminders have none. */
  at?: string;
}

/** A sprint reminder appears this many days before the sprint ends. */
const SPRINT_WARNING_DAYS = 2;
const MAX_NOTIFICATIONS = 15;

/**
 * There is no notifications collection. Everything here is worked out from
 * data that already exists:
 *   - tasks assigned to you that are not done yet,
 *   - tasks waiting in Review (only for testers, managers and admins,
 *     who are the ones who sign work off),
 *   - an active sprint that ends within two days.
 */
export function buildNotifications(
  user: { _id: string; role: string },
  data: ProjectData[]
): AppNotification[] {
  const reminders: AppNotification[] = [];
  const updates: AppNotification[] = [];

  for (const { project, tasks, sprints } of data) {
    const board =
      project.methodology === "kanban"
        ? `/projects/${project._id}/kanban`
        : `/projects/${project._id}/sprints`;

    for (const sprint of sprints) {
      if (sprint.status !== "active") continue;
      const days = daysLeft(sprint.endDate);
      if (days > SPRINT_WARNING_DAYS) continue;

      const when =
        days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
      reminders.push({
        key: `sprint:${sprint._id}:${days}`,
        text: `${sprintLabel(sprint, sprints)} ends ${when}`,
        detail: project.name,
        link: board,
      });
    }

    for (const task of tasks) {
      const at = task.updatedAt ?? task.createdAt;

      if (task.status !== "done" && sameId(task.assignee, user._id)) {
        updates.push({
          key: `assigned:${task._id}`,
          text: `“${task.title}” is assigned to you`,
          detail: project.name,
          link: board,
          at,
        });
      }

      if (task.status === "review" && task.sprint && canMarkDone(user.role)) {
        updates.push({
          key: `review:${task._id}:${at ?? ""}`,
          text: `“${task.title}” moved to Review`,
          detail: project.name,
          link: board,
          at,
        });
      }
    }
  }

  updates.sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
  );

  return [...reminders, ...updates].slice(0, MAX_NOTIFICATIONS);
}
