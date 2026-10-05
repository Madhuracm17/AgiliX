import { Fragment, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { usePendingDeletes } from "../approvals/usePendingDeletes";
import { personLabel, useProjectPeople } from "../team/useProjectPeople";
import { getSprints, type Sprint } from "../../api/sprints";
import {
  TASK_TYPES,
  addTaskToSprint,
  createTask,
  deleteTask,
  getBacklogTasks,
  getTasks,
  isPendingApproval,
  updateTask,
  type Task,
  type TaskType,
} from "../../api/tasks";
import type { TaskSuggestion } from "../../api/ai";
import TaskSuggestions from "../ai/TaskSuggestions";
import {
  canEditTaskPlan,
  priorityLabel,
  readError,
  sameId,
  sprintLabel,
  statusLabel,
  typeLabel,
} from "./taskDisplay";
import "./scrum.css";

type AddMode = "ai" | null;

const SPRINT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
};

// Active sprint first, then planned (earliest first), then completed (newest first).
function sortSprints(sprints: Sprint[]): Sprint[] {
  const rank: Record<string, number> = { active: 0, planned: 1, completed: 2 };
  const time = (s: Sprint) => new Date(s.completedAt ?? s.startDate).getTime();
  return [...sprints].sort((a, b) => {
    const byStatus = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (byStatus !== 0) return byStatus;
    return a.status === "completed" ? time(b) - time(a) : time(a) - time(b);
  });
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Product Backlog (Figma "Product Backlog" screen). New tasks are created
 * here, in one of two ways: AI suggestions (each one can be added to a
 * sprint or to the backlog) or the user's own New Task form. Below that:
 * every sprint with its tasks (active, planned, completed) and the backlog. Opening a backlog row shows
 * its type, assignee and "Add to sprint".
 */
export default function ProductBacklogPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  // Changing a task's priority after it exists is for managers and admins.
  const canEditPlan = canEditTaskPlan(user.role);
  const { pendingDeleteIds, declinedDeleteIds, markRequested } = usePendingDeletes(
    projectId,
    !canEditPlan,
  );
  // The project team, for the "Assignee" dropdown (admins and managers only).
  const people = useProjectPeople(canEditPlan ? projectId : undefined);
  const navigate = useNavigate();
  // Back goes to the Scrum Board only when the person came from it;
  // otherwise it goes back to the project page.
  const location = useLocation();
  const cameFromBoard =
    (location.state as { from?: string } | null)?.from === "scrum-board";
  // /backlog?task=<id> (from My Tasks) opens that task's row.
  const [searchParams] = useSearchParams();

  const [backlog, setBacklog] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  // Every task of the project, used to list each sprint with its tasks.
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  // Sprint tables the user opened or closed (completed sprints start closed).
  const [toggledSprints, setToggledSprints] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(searchParams.get("task"));

  // "Add a task" chooser and the AI suggestion buttons.
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [addedSuggestions, setAddedSuggestions] = useState<Record<string, string>>({});
  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
  const [pickingSprintFor, setPickingSprintFor] = useState<string | null>(null);

  // quiet = refresh the tables without the "Loading…" screen (keeps the
  // AI suggestions on screen after one of them is added).
  const load = async (quiet = false) => {
    if (!projectId) return;
    try {
      if (!quiet) setLoading(true);
      setError("");
      const [backlogData, sprintData, taskData] = await Promise.all([
        getBacklogTasks(projectId),
        getSprints(projectId),
        getTasks(projectId),
      ]);
      setBacklog(backlogData);
      setSprints(sprintData);
      setAllTasks(taskData);
    } catch (err) {
      setError(readError(err, "Failed to load backlog"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectId]);

  // Tasks can only be added to sprints that are not completed yet.
  const openSprints = sprints.filter((s) => s.status !== "completed");
  const orderedSprints = sortSprints(sprints);
  const tasksOf = (sprint: Sprint) =>
    allTasks.filter((t) => sameId(t.sprint, sprint._id));

  const isOpen = (sprint: Sprint) =>
    toggledSprints[sprint._id] ?? sprint.status !== "completed";
  const toggleSprint = (sprint: Sprint) =>
    setToggledSprints((prev) => ({ ...prev, [sprint._id]: !isOpen(sprint) }));

  // Update one backlog task locally (a full reload would close the open row).
  const patchLocal = (taskId: string, changes: Partial<Task>) =>
    setBacklog((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, ...changes } : t))
    );

  // Admins and managers assign a task to a team member (or clear it).
  const changeAssignee = async (taskId: string, personId: string) => {
    try {
      const person = people.find((p) => p._id === personId);
      await updateTask(taskId, { assignee: personId || null });
      const assignee = person
        ? ({ _id: person._id, name: person.name, email: person.email } as Task["assignee"])
        : null;
      patchLocal(taskId, { assignee });
      setAllTasks((prev) =>
        prev.map((t) => (t._id === taskId ? { ...t, assignee } : t))
      );
    } catch (err) {
      alert(readError(err, "Failed to change the assignee"));
    }
  };

  const changeType = async (taskId: string, type: TaskType) => {
    try {
      await updateTask(taskId, { type });
      patchLocal(taskId, { type });
    } catch (err) {
      alert(readError(err, "Failed to change the task type"));
    }
  };

  const addToSprint = async (taskId: string, sprintId: string) => {
    if (!sprintId) return;
    try {
      await addTaskToSprint(taskId, sprintId);
      // The task leaves the backlog once it has a sprint.
      setOpenTaskId(null);
      await load(true);
    } catch (err) {
      alert(readError(err, "Failed to add task to sprint"));
    }
  };

  // Managers and admins delete the task at once; developers and testers send a
  // request that a manager has to approve.
  const removeTask = async (task: Task) => {
    const question = canEditPlan
      ? `Delete “${task.title}”? This cannot be undone.`
      : `Ask a manager to delete “${task.title}”?`;
    if (!window.confirm(question)) return;
    try {
      const result = await deleteTask(task._id);
      if (isPendingApproval(result)) {
        markRequested(task._id);
        alert(result.message);
        return;
      }
      setOpenTaskId(null);
      await load(true);
    } catch (err) {
      alert(readError(err, "Failed to delete the task"));
    }
  };

  // Turns an AI suggestion into a real task — only when the user clicks
  // "Add to Sprint" or "Add to Backlog". sprintId = null means the backlog.
  const addSuggestion = async (suggestion: TaskSuggestion, sprintId: string | null) => {
    if (!projectId || addingSuggestion) return;
    const key = suggestion.title;
    try {
      setAddingSuggestion(key);
      setPickingSprintFor(null);
      const created = await createTask({
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority,
        project: projectId,
      });

      // Developers and testers need a manager's approval: nothing is created yet.
      if (isPendingApproval(created)) {
        setAddedSuggestions((prev) => ({
          ...prev,
          [key]: "Sent to a manager for approval",
        }));
        return;
      }

      if (sprintId) await addTaskToSprint(created._id, sprintId);

      const sprint = sprints.find((s) => s._id === sprintId);
      setAddedSuggestions((prev) => ({
        ...prev,
        [key]: sprint
          ? `Added to ${sprintLabel(sprint, sprints)}`
          : "Added to the backlog",
      }));
      await load(true);
    } catch (err) {
      alert(readError(err, "Failed to add the suggested task"));
    } finally {
      setAddingSuggestion(null);
    }
  };

  // "Add to Sprint" shows the open sprints, e.g. "Sprint 5 (login page)",
  // and the task is added to the one the user picks.
  const addSuggestionToSprint = (suggestion: TaskSuggestion) => {
    setPickingSprintFor((current) =>
      current === suggestion.title ? null : suggestion.title
    );
  };

  const renderSuggestionActions = (suggestion: TaskSuggestion) => {
    const key = suggestion.title;
    const added = addedSuggestions[key];
    if (added) return <p className="scrum-suggestion-added">✓ {added}</p>;

    const busy = addingSuggestion === key;
    return (
      <div className="scrum-suggestion-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || openSprints.length === 0}
          title={openSprints.length === 0 ? "No planned or active sprint yet" : undefined}
          onClick={() => addSuggestionToSprint(suggestion)}
        >
          {busy ? "Adding…" : "Add to Sprint"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => addSuggestion(suggestion, null)}
        >
          Add to Backlog
        </button>

        {pickingSprintFor === key && (
          <select
            value=""
            aria-label="Choose a sprint"
            onChange={(e) => e.target.value && addSuggestion(suggestion, e.target.value)}
          >
            <option value="">Choose a sprint…</option>
            {openSprints.map((sprint) => (
              <option key={sprint._id} value={sprint._id}>
                {sprintLabel(sprint, sprints)}
                {sprint.status === "active" ? " · Active" : " · Planned"}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="scrum-page">
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() =>
              navigate(
                cameFromBoard
                  ? `/projects/${projectId}/sprints`
                  : `/projects/${projectId}`,
              )
            }
          >
            {cameFromBoard ? "← Scrum Board" : "← Project"}
          </p>
          <h1>Product Backlog</h1>
          <p className="page-description">
            Create tasks, then plan them into sprints.
          </p>
        </div>
      </div>

      <section className="scrum-panel">
        <div className="scrum-panel-header">
          <h2>Add a task</h2>
          <span className="scrum-panel-meta">Choose how</span>
        </div>

        <div className="scrum-add-options">
          <button
            type="button"
            className={`scrum-add-option ${addMode === "ai" ? "selected" : ""}`}
            aria-pressed={addMode === "ai"}
            onClick={() => setAddMode(addMode === "ai" ? null : "ai")}
          >
            <strong>AI Suggestions</strong>
            <span>Let AI suggest tasks based on this backlog</span>
          </button>
          <button
            type="button"
            className="scrum-add-option"
            onClick={() => navigate(`/projects/${projectId}/tasks/new?sprint=backlog`)}
          >
            <strong>+ Create New Task</strong>
            <span>Create a task manually</span>
          </button>
        </div>

        {addMode === "ai" && projectId && (
          <div className="scrum-add-ai">
            <TaskSuggestions
              projectId={projectId}
              renderActions={renderSuggestionActions}
            />
          </div>
        )}
      </section>

      {loading && (
        <div className="empty-state">
          <h2>Loading backlog...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load backlog</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {orderedSprints.length === 0 && (
            <section className="scrum-panel">
              <div className="scrum-panel-header">
                <h2>
                  Sprints <span>none yet</span>
                </h2>
              </div>
              <p className="scrum-panel-empty">
                No sprints yet. Create one on the{" "}
                <button
                  type="button"
                  className="scrum-inline-link"
                  onClick={() => navigate(`/projects/${projectId}/sprints`)}
                >
                  Scrum Board
                </button>
                .
              </p>
            </section>
          )}

          {orderedSprints.map((sprint) => {
            const tasks = tasksOf(sprint);
            const done = tasks.filter((t) => t.status === "done").length;
            const points = tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
            const open = isOpen(sprint);

            return (
              <section
                key={sprint._id}
                className={`scrum-panel scrum-sprint-panel scrum-sprint-${sprint.status}`}
              >
                <button
                  type="button"
                  className="scrum-panel-header scrum-sprint-toggle"
                  aria-expanded={open}
                  onClick={() => toggleSprint(sprint)}
                >
                  <h2>
                    {sprintLabel(sprint, sprints)}{" "}
                    <span>· {SPRINT_STATUS_LABEL[sprint.status] ?? sprint.status}</span>
                  </h2>
                  <span className="scrum-panel-meta">
                    {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)} ·{" "}
                    {done}/{tasks.length} done · {points} pts{" "}
                    <span className="scrum-chevron">{open ? "▴" : "▾"}</span>
                  </span>
                </button>

                {open &&
                  (tasks.length === 0 ? (
                    <p className="scrum-panel-empty">
                      {sprint.status === "completed"
                        ? "No tasks were finished in this sprint."
                        : "No tasks in this sprint yet. Open a backlog task below and add it to this sprint."}
                    </p>
                  ) : (
                    <div className="scrum-table-wrap">
                      <table className="scrum-table">
                        <thead>
                          <tr>
                            <th>Task</th>
                            <th>Priority</th>
                            <th>Pts</th>
                            <th>Assignee</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasks.map((task) => (
                            <tr key={task._id}>
                              <td className={task.status === "done" ? "scrum-done" : ""}>
                                {task.title}
                              </td>
                              <td>
                                <span className={`priority-badge priority-${task.priority}`}>
                                  {priorityLabel(task.priority)}
                                </span>
                              </td>
                              <td>{task.storyPoints ?? 0}</td>
                              <td>{task.assignee?.name ?? "Unassigned"}</td>
                              <td>{statusLabel(task.status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </section>
            );
          })}

          <section className="scrum-panel">
            <div className="scrum-panel-header">
              <h2>
                Backlog{" "}
                <span>
                  {backlog.length} item{backlog.length === 1 ? "" : "s"}
                </span>
              </h2>
            </div>

            {backlog.length === 0 ? (
              <p className="scrum-panel-empty">
                The backlog is empty. Add a task above — with AI suggestions or
                yourself.
              </p>
            ) : (
              <div className="scrum-table-wrap">
                <table className="scrum-table scrum-table-clickable">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Priority</th>
                      <th>Est Pts</th>
                      <th>Type</th>
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {backlog.map((task) => {
                      const open = openTaskId === task._id;
                      return (
                        <Fragment key={task._id}>
                          <tr
                            className={open ? "scrum-row-open" : ""}
                            onClick={() => setOpenTaskId(open ? null : task._id)}
                          >
                            <td>{task.title}</td>
                            <td>
                              <span
                                className={`priority-badge priority-${task.priority}`}
                              >
                                {priorityLabel(task.priority)}
                              </span>
                            </td>
                            <td>{(task.storyPoints ?? 0) > 0 ? task.storyPoints : "—"}</td>
                            <td>{typeLabel(task.type)}</td>
                            <td className="scrum-chevron">{open ? "▴" : "▾"}</td>
                          </tr>

                          {open && projectId && (
                            <tr className="scrum-detail-row">
                              <td colSpan={5}>
                                <div className="scrum-detail">
                                  <p className="scrum-detail-text">
                                    {task.description || "No description"}
                                    {task.assignee && (
                                      <>
                                        {" · "}
                                        <strong>{task.assignee.name}</strong>
                                      </>
                                    )}
                                  </p>

                                  <div className="scrum-detail-controls">
                                    <label>
                                      Type
                                      <select
                                        value={task.type ?? ""}
                                        onChange={(e) =>
                                          changeType(task._id, e.target.value as TaskType)
                                        }
                                      >
                                        <option value="" disabled>
                                          Select type
                                        </option>
                                        {TASK_TYPES.map((t) => (
                                          <option key={t.value} value={t.value}>
                                            {t.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    {canEditPlan && (
                                      <label>
                                        Assignee
                                        <select
                                          value={task.assignee?._id ?? ""}
                                          onChange={(e) =>
                                            changeAssignee(task._id, e.target.value)
                                          }
                                        >
                                          <option value="">Unassigned</option>
                                          {people.map((person) => (
                                            <option key={person._id} value={person._id}>
                                              {personLabel(person, user._id)}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )}

                                    {openSprints.length > 0 && !canEditPlan && task.assignee && !sameId(task.assignee, user._id) && (
                                      <p className="new-task-hint">
                                        Assigned to {task.assignee.name}. Only they or a manager can add it to a sprint.
                                      </p>
                                    )}

                                    {openSprints.length > 0 && (canEditPlan || !task.assignee || sameId(task.assignee, user._id)) && (
                                      <label>
                                        Sprint
                                        <select
                                          value=""
                                          onChange={(e) =>
                                            addToSprint(task._id, e.target.value)
                                          }
                                        >
                                          <option value="">+ Add to sprint...</option>
                                          {openSprints.map((sprint) => (
                                            <option key={sprint._id} value={sprint._id}>
                                              {sprintLabel(sprint, sprints)}
                                              {sprint.status === "active" ? " · Active" : " · Planned"}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )}
                                  </div>

                                  <div className="task-delete-row">
                                    {canEditPlan || task.status === "todo" ? (
                                      <>
                                        <button
                                          type="button"
                                          className="task-delete-button"
                                          onClick={() => removeTask(task)}
                                          disabled={
                                            !canEditPlan &&
                                            (pendingDeleteIds.has(task._id) ||
                                              declinedDeleteIds.has(task._id))
                                          }
                                        >
                                          {canEditPlan
                                            ? "Delete task"
                                            : declinedDeleteIds.has(task._id)
                                              ? "Deletion declined"
                                              : pendingDeleteIds.has(task._id)
                                                ? "Deletion requested"
                                                : "Request deletion"}
                                        </button>
                                        {!canEditPlan && (
                                          <span>
                                            {declinedDeleteIds.has(task._id)
                                              ? "A manager declined this request."
                                              : pendingDeleteIds.has(task._id)
                                                ? "Waiting for a manager."
                                                : "A manager has to approve it."}
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <span>
                                        Deletion can only be requested while a task is in To Do.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </>
      )}
    </div>
  );
}
