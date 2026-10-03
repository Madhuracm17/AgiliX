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

/** A deadline reminder appears this many days before the sprint ends. */
const SPRINT_WARNING_DAYS = 2;
const MAX_NOTIFICATIONS = 20;

/**
 * The bell shows two kinds of news:
 *   - messages the backend saved for this person (a task sent back from Review
 *     with a comment, a request waiting for a manager's approval, the manager's
 *     answer), passed in as `saved`;
 *   - things worked out from data that already exists:
 *       - tasks assigned to you that are not done yet,
 *       - tasks waiting in Review (only for testers, managers and admins,
 *         who are the ones who sign work off),
 *       - a deadline reminder: an active sprint ends within two days and you
 *         still have unfinished tasks assigned to you in it.
 */
export function buildNotifications(
  user: { _id: string; role: string },
  data: ProjectData[],
  saved: AppNotification[] = []
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

      // Only the people who still have work to finish in the sprint are warned.
      const unfinished = tasks.filter(
        (task) =>
          task.status !== "done" &&
          sameId(task.sprint, sprint._id) &&
          sameId(task.assignee, user._id)
      ).length;
      if (unfinished === 0) continue;

      const when =
        days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
      const mine =
        unfinished === 1 ? "1 of your tasks is" : `${unfinished} of your tasks are`;
      reminders.push({
        key: `sprint:${sprint._id}:${days}:${unfinished}`,
        text: `${sprintLabel(sprint, sprints)} ends ${when}: ${mine} not done yet`,
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
          link: task.sprint ? `${board}?task=${task._id}` : board,
          at,
        });
      }

      if (task.status === "review" && task.sprint && canMarkDone(user.role)) {
        updates.push({
          key: `review:${task._id}:${at ?? ""}`,
          text: `“${task.title}” moved to Review`,
          detail: project.name,
          link: `${board}?task=${task._id}`,
          at,
        });
      }
    }
  }

  const news = [...saved, ...updates].sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
  );

  return [...reminders, ...news].slice(0, MAX_NOTIFICATIONS);
}
