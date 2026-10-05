import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { usePendingDeletes } from "../approvals/usePendingDeletes";
import { personLabel, useProjectPeople } from "../team/useProjectPeople";
import { createSprint, getSprints, type Sprint } from "../../api/sprints";
import {
  deleteTask,
  getTasks,
  isPendingApproval,
  updateTask,
  type SprintStats,
  type Task,
  type TaskStatus,
} from "../../api/tasks";
import SprintDetails from "../sprints/SprintDetails";
import SprintProgress from "../sprints/SprintProgress";
import SprintStatusBadge from "../sprints/SprintStatusBadge";
import {
  SCRUM_COLUMNS,
  SPRINT_WEEK_OPTIONS,
  canManageSprints,
  canEditTaskPlan,
  canMarkDone,
  formatLongDate,
  initials,
  nextSprintDates,
  nextStatus,
  priorityLabel,
  readError,
  sameId,
  sprintLabel,
  statusLabel,
  typeLabel,
} from "./taskDisplay";
import "./scrum.css";

interface ScrumBoardPageProps {
  /** Extra per-task tools rendered on each card (App.tsx passes the time tracker). */
  renderTaskTools?: (task: Task) => ReactNode;
}

/**
 * Scrum Board (Figma "Scrum Board" screen): sprint tabs, sprint details
 * (start / complete), progress, and the To Do / In Progress / Review / Done
 * board for the selected sprint.
 */
export default function ScrumBoardPage({ renderTaskTools }: ScrumBoardPageProps) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Only admins and managers create sprints (also enforced by the backend).
  const canManage = canManageSprints(user.role);
  // Only testers, managers and admins move a task from Review to Done.
  const signOff = canMarkDone(user.role);
  // Admins and managers can reassign a task to another team member.
  const canReassign = canEditTaskPlan(user.role);
  const { pendingDeleteIds, declinedDeleteIds, markRequested } = usePendingDeletes(
    projectId,
    !canReassign,
  );
  const people = useProjectPeople(canReassign ? projectId : undefined);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<SprintStats | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  // Sprint length in weeks; the dates are worked out from it.
  const [weeks, setWeeks] = useState(2);

  // "Send back to In Progress" (a tester's step back from Review), with its comment.
  const [bouncingId, setBouncingId] = useState<string | null>(null);
  const [bounceText, setBounceText] = useState("");
  const [bounceBusy, setBounceBusy] = useState(false);

  // A link such as /sprints?task=<id> (from My Tasks or a notification) opens that
  // task's sprint and highlights its card.
  const [searchParams] = useSearchParams();
  const focusTaskId = searchParams.get("task");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusedSprintFor = useRef<string | null>(null);

  const [movingToBacklogId, setMovingToBacklogId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  // The card being dragged, so only its next column accepts the drop.
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  const loadSprints = async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError("");
      const data = await getSprints(projectId);
      setSprints(data);
      // Keep the selected tab after a reload; otherwise open the active
      // sprint (or the first one).
      setSelectedSprintId((current) => {
        if (current && data.some((s) => s._id === current)) return current;
        const active = data.find((s) => s.status === "active");
        return active?._id ?? data[0]?._id ?? null;
      });
    } catch (err) {
      setError(readError(err, "Failed to load sprints"));
    } finally {
      setLoading(false);
    }
  };

  // The sprint's tasks come from the project's task list (the same list the
  // Product Backlog page uses), so every task in the sprint shows up here, however
  // it got there (added by a manager, or approved from a request).
  const loadSprintDetails = async (sprintId: string) => {
    if (!projectId) return;
    try {
      const all = await getTasks(projectId);
      const taskData = all.filter((t) => sameId(t.sprint, sprintId));
      const count = (status: Task["status"]) => taskData.filter((t) => t.status === status).length;
      const points = (list: Task[]) => list.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      const done = taskData.filter((t) => t.status === "done");
      setSprintTasks(taskData);
      setStats({
        total: taskData.length,
        done: done.length,
        inProgress: count("in_progress"),
        review: count("review"),
        todo: count("todo"),
        totalStoryPoints: points(taskData),
        completedStoryPoints: points(done),
      });
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadSprints();
  }, [projectId]);

  useEffect(() => {
    if (selectedSprintId) loadSprintDetails(selectedSprintId);
  }, [selectedSprintId]);

  // Keep the board current: a manager may add or approve tasks while this page is
  // open, so reload the sprint every 15 seconds and when the tab is focused again.
  useEffect(() => {
    if (!selectedSprintId) return;
    const refresh = () => {
      if (document.visibilityState === "visible") loadSprintDetails(selectedSprintId);
    };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [selectedSprintId]);

  // Open the sprint that holds the task from the link (once per link).
  useEffect(() => {
    if (!focusTaskId || !projectId || sprints.length === 0) return;
    if (focusedSprintFor.current === focusTaskId) return;
    focusedSprintFor.current = focusTaskId;
    getTasks(projectId)
      .then((all) => {
        const target = all.find((t) => t._id === focusTaskId);
        const sprint = target && sprints.find((sp) => sameId(target.sprint, sp._id));
        if (sprint) setSelectedSprintId(sprint._id);
      })
      .catch(() => {
        // The board still opens; it just is not moved to that sprint.
      });
  }, [focusTaskId, projectId, sprints]);

  // Once the cards are on screen, scroll to the task and highlight it for a moment.
  useEffect(() => {
    if (!focusTaskId || !sprintTasks.some((t) => t._id === focusTaskId)) return;
    setHighlightId(focusTaskId);
    document
      .getElementById(`task-card-${focusTaskId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlightId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusTaskId, sprintTasks]);

  const selectedSprint = sprints.find((s) => s._id === selectedSprintId) ?? null;
  // Completed sprints are a record: their board can no longer be changed.
  const sprintIsLocked = selectedSprint?.status === "completed";

  // Finished tasks stay on the board only until the sprint's last date. After that
  // they are hidden (they are still counted in the progress bar and the reports).
  const pastLastDate = (() => {
    if (!selectedSprint) return false;
    const end = new Date(selectedSprint.endDate);
    end.setHours(23, 59, 59, 999);
    return Date.now() > end.getTime();
  })();
  const visibleTasks = pastLastDate
    ? sprintTasks.filter((t) => t.status !== "done")
    : sprintTasks;
  const hiddenDoneCount = sprintTasks.length - visibleTasks.length;

  // To Do → In Progress → Review is the assignee's own work, so only they can do it
  // (not even a manager). Review → Done is the sign-off by a tester, manager or admin.
  const isAssignee = (task: Task) => sameId(task.assignee, user._id);
  const canMove = (task: Task, status: TaskStatus) =>
    status === "done" ? signOff : isAssignee(task);

  // Moves a task one step forward (To Do → In Progress → Review → Done).
  // Any other move is ignored here and also rejected by the backend.
  const moveTask = async (taskId: string, status: TaskStatus) => {
    const task = sprintTasks.find((t) => t._id === taskId);
    if (!task || sprintIsLocked || nextStatus(task.status) !== status) return;
    if (!canMove(task, status)) return;

    // Optimistic update; stats are refetched afterwards.
    setSprintTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, status } : t))
    );

    try {
      await updateTask(taskId, { status });
    } catch (err) {
      alert(readError(err, "Failed to move task"));
    }
    if (selectedSprintId) await loadSprintDetails(selectedSprintId);
  };

  // A tester (or manager or admin) found a problem in Review: the task goes back to
  // In Progress and the person it is assigned to is told what to fix.
  const sendBack = async (task: Task) => {
    const comment = bounceText.trim();
    if (!comment) {
      alert("Please write what needs to be fixed, so the developer knows.");
      return;
    }
    try {
      setBounceBusy(true);
      await updateTask(task._id, { status: "in_progress", reviewComment: comment });
      setBouncingId(null);
      setBounceText("");
      if (selectedSprintId) await loadSprintDetails(selectedSprintId);
    } catch (err) {
      alert(readError(err, "Could not send the task back"));
    } finally {
      setBounceBusy(false);
    }
  };

  // Managers and admins delete a task at once; developers and testers send a
  // request that a manager has to approve.
  const removeTask = async (task: Task) => {
    const question = canReassign
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
      if (selectedSprintId) await loadSprintDetails(selectedSprintId);
    } catch (err) {
      alert(readError(err, "Failed to delete the task"));
    }
  };

  const reassign = async (task: Task, personId: string) => {
    try {
      await updateTask(task._id, { assignee: personId || null });
      if (selectedSprintId) await loadSprintDetails(selectedSprintId);
    } catch (err) {
      alert(readError(err, "Failed to change the assignee"));
    }
  };

  const moveToBacklog = async (task: Task) => {
    if (!selectedSprintId) return;
    try {
      setMovingToBacklogId(task._id);
      await updateTask(task._id, { sprint: null });
      await loadSprintDetails(selectedSprintId);
    } catch (err) {
      alert(readError(err, "Failed to move the task back to the backlog"));
    } finally {
      setMovingToBacklogId(null);
    }
  };

  // Dates of the sprint being created, from the chosen number of weeks.
  const newSprintDates = nextSprintDates(sprints, weeks);

  const submitSprint = async () => {
    if (!projectId) return;
    if (!name.trim()) {
      alert("Please enter a sprint name.");
      return;
    }

    try {
      setCreating(true);
      const created = await createSprint({
        name: name.trim(),
        project: projectId,
        goal: goal.trim(),
        startDate: newSprintDates.startDate,
        endDate: newSprintDates.endDate,
      });
      setName("");
      setGoal("");
      setWeeks(2);
      setShowForm(false);
      await loadSprints();
      setSelectedSprintId(created._id);
    } catch (err) {
      alert(readError(err, "Failed to create sprint"));
    } finally {
      setCreating(false);
    }
  };

  // ---- drag and drop: a card can only be dropped on its next column ----
  const onDragStart = (event: DragEvent, task: Task) => {
    event.dataTransfer.setData("text/plain", task._id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingTask(task);
  };

  const onDragEnd = () => {
    setDraggingTask(null);
    setDragOver(null);
  };

  const canDropOn = (status: TaskStatus) =>
    !sprintIsLocked &&
    draggingTask !== null &&
    nextStatus(draggingTask.status) === status &&
    canMove(draggingTask, status);

  const onDrop = (event: DragEvent, status: TaskStatus) => {
    event.preventDefault();
    const task = draggingTask;
    onDragEnd();
    if (task) moveTask(task._id, status);
  };

  const inProgressCount = (stats?.inProgress ?? 0) + (stats?.review ?? 0);
  const inProgressPoints = sprintTasks
    .filter((t) => t.status === "in_progress" || t.status === "review")
    .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);

  return (
    <div className="scrum-page">
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Project
          </p>
          <h1>Scrum Board</h1>
          <p className="page-description">
            Move sprint tasks from To Do to Done.
          </p>
        </div>

        <div className="scrum-header-actions">
          {canManage && (
            <button className="secondary-button" onClick={() => setShowForm(true)}>
              + New Sprint
            </button>
          )}
          {user.role !== "admin" && (
            <button
              className="secondary-button"
              onClick={() => navigate(`/projects/${projectId}/reports`)}
            >
              Reports
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/approvals`)}
          >
            Approvals
          </button>
          <button
            className="primary-button"
            onClick={() =>
              navigate(`/projects/${projectId}/backlog`, { state: { from: "scrum-board" } })
            }
          >
            Product Backlog
          </button>
        </div>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>Create Sprint</h2>

          <label>Sprint name</label>
          <input
            type="text"
            placeholder="e.g. Login page"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Sprint goal (optional)</label>
          <textarea
            placeholder="What should this sprint achieve?"
            value={goal}
            maxLength={500}
            onChange={(e) => setGoal(e.target.value)}
          />

          <label htmlFor="new-sprint-weeks">Sprint duration</label>
          <select
            id="new-sprint-weeks"
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          >
            {SPRINT_WEEK_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w} {w === 1 ? "week" : "weeks"}
              </option>
            ))}
          </select>
          <p className="scrum-sprint-dates">
            Runs {formatLongDate(newSprintDates.startDate)} –{" "}
            {formatLongDate(newSprintDates.endDate)}
          </p>

          <div className="form-actions">
            <button className="secondary-button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={submitSprint}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Sprint"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <h2>Loading sprints...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load sprints</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && sprints.length === 0 && (
        <div className="empty-state">
          <h2>No sprints yet</h2>
          <p>
            {canManage
              ? "Create your first sprint with “+ New Sprint” to start planning."
              : "An admin or manager will create the first sprint."}
          </p>
        </div>
      )}

      {!loading && !error && sprints.length > 0 && (
        <>
          <div className="sprint-tabs">
            {sprints.map((sprint) => (
              <button
                key={sprint._id}
                className={`sprint-tab ${
                  selectedSprintId === sprint._id ? "active" : ""
                }`}
                onClick={() => setSelectedSprintId(sprint._id)}
              >
                {sprintLabel(sprint, sprints)}
                <SprintStatusBadge status={sprint.status} />
              </button>
            ))}
          </div>

          {selectedSprint && (
            <SprintDetails
              key={selectedSprint._id}
              sprint={selectedSprint}
              unfinishedCount={stats ? stats.total - stats.done : 0}
              allSprints={sprints}
              onChanged={async () => {
                await loadSprints();
                await loadSprintDetails(selectedSprint._id);
              }}
            />
          )}

          {stats && stats.total > 0 && (
            <SprintProgress
              totalTasks={stats.total}
              doneTasks={stats.done}
              inProgressTasks={inProgressCount}
              totalStoryPoints={stats.totalStoryPoints}
              completedStoryPoints={stats.completedStoryPoints}
              inProgressStoryPoints={inProgressPoints}
            />
          )}

          {hiddenDoneCount > 0 && (
            <p className="scrum-hidden-note">
              {hiddenDoneCount} completed {hiddenDoneCount === 1 ? "task is" : "tasks are"} no longer
              shown because this sprint's last date has passed. They still count in the reports.
            </p>
          )}

          {sprintTasks.length === 0 && (
            <p className="page-description scrum-hint">
              No tasks in this sprint yet. Create tasks and add them to this
              sprint from the Product Backlog.
            </p>
          )}

          <div className="scrum-board">
            {SCRUM_COLUMNS.map((column) => {
              const columnTasks = visibleTasks.filter((t) => t.status === column.key);

              return (
                <div
                  key={column.key}
                  className={`scrum-column ${
                    dragOver === column.key ? "scrum-column-over" : ""
                  }`}
                  onDragOver={(e) => {
                    // Not calling preventDefault() = the browser refuses the drop.
                    if (!canDropOn(column.key)) return;
                    e.preventDefault();
                    setDragOver(column.key);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => onDrop(e, column.key)}
                >
                  <div className="scrum-column-header">
                    <span>{column.label}</span>
                    <span className="scrum-column-count">{columnTasks.length}</span>
                  </div>

                  <div className="scrum-column-body">
                    {columnTasks.length === 0 && (
                      <p className="scrum-empty">No tasks here</p>
                    )}

                    {columnTasks.map((task) => (
                      <div
                        key={task._id}
                        id={`task-card-${task._id}`}
                        className={`scrum-card ${highlightId === task._id ? "scrum-card-highlight" : ""}`}
                        draggable={
                          !sprintIsLocked &&
                          task.status !== "done" &&
                          (task.status === "review" ? signOff : isAssignee(task))
                        }
                        onDragStart={(e) => onDragStart(e, task)}
                        onDragEnd={onDragEnd}
                      >
                        <div className="scrum-tags">
                          <span className={`scrum-tag scrum-tag-${task.priority}`}>
                            {priorityLabel(task.priority)}
                          </span>
                          {task.type && (
                            <span className="scrum-tag">{typeLabel(task.type)}</span>
                          )}
                        </div>

                        <h3 className={task.status === "done" ? "scrum-done" : ""}>
                          {task.title}
                        </h3>
                        {task.description && (
                          <p className="scrum-summary">{task.description}</p>
                        )}

                        {/* What the tester asked to fix, while the task is back in progress. */}
                        {task.reviewNote && task.status === "in_progress" && (
                          <p className="scrum-review-note">
                            <strong>Sent back by {task.reviewNote.byName || "a tester"}</strong>
                            {task.reviewNote.text}
                          </p>
                        )}

                        <div className="scrum-card-footer">
                          <span>{task.storyPoints ?? 0} pts</span>
                          <span
                            className={`scrum-avatar ${
                              task.assignee ? "" : "scrum-avatar-empty"
                            }`}
                            title={task.assignee?.name ?? "Unassigned"}
                          >
                            {task.assignee ? initials(task.assignee.name) : "?"}
                          </span>
                        </div>

                        {canReassign && !sprintIsLocked && (
                          <select
                            className="scrum-assignee-select"
                            aria-label={`Assignee of ${task.title}`}
                            value={task.assignee?._id ?? ""}
                            onChange={(e) => reassign(task, e.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {people.map((person) => (
                              <option key={person._id} value={person._id}>
                                {personLabel(person, user._id)}
                              </option>
                            ))}
                          </select>
                        )}

                        {renderTaskTools?.(task)}

                        {!sprintIsLocked && (
                          <div className="scrum-card-actions">
                            {task.status === "review" && !signOff ? (
                              <p className="scrum-card-final scrum-card-waiting">
                                Waiting for a tester to sign off
                              </p>
                            ) : task.status !== "review" && task.status !== "done" && !isAssignee(task) ? (
                              // Someone else's task: no button and no explanation needed.
                              task.assignee ? null : (
                                <p className="scrum-card-final scrum-card-waiting">
                                  Assign this task before moving it
                                </p>
                              )
                            ) : nextStatus(task.status) ? (
                              <button
                                type="button"
                                className="scrum-move-button"
                                onClick={() => {
                                  const next = nextStatus(task.status);
                                  if (next) moveTask(task._id, next);
                                }}
                              >
                                Move to {statusLabel(nextStatus(task.status) ?? task.status)} →
                              </button>
                            ) : (
                              <p className="scrum-card-final">✓ Done</p>
                            )}

                            {/* A tester can send work back from Review, with a comment. */}
                            {task.status === "review" && signOff && (
                              bouncingId === task._id ? (
                                <div className="scrum-bounce">
                                  <textarea
                                    aria-label={`What needs to be fixed in ${task.title}`}
                                    placeholder="What needs to be fixed?"
                                    value={bounceText}
                                    maxLength={1000}
                                    onChange={(e) => setBounceText(e.target.value)}
                                  />
                                  <div className="scrum-bounce-actions">
                                    <button
                                      type="button"
                                      className="scrum-bounce-button"
                                      disabled={bounceBusy}
                                      onClick={() => sendBack(task)}
                                    >
                                      {bounceBusy ? "Sending…" : "Send back"}
                                    </button>
                                    <button
                                      type="button"
                                      className="sprint-card-backlog-button"
                                      disabled={bounceBusy}
                                      onClick={() => {
                                        setBouncingId(null);
                                        setBounceText("");
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="scrum-bounce-button"
                                  onClick={() => {
                                    setBouncingId(task._id);
                                    setBounceText("");
                                  }}
                                >
                                  ↩ Found a bug? Send back
                                </button>
                              )
                            )}

                            {/* Only work that hasn't reached Review can go back to the backlog. */}
                            {(task.status === "todo" || task.status === "in_progress") &&
                              (!task.assignee || isAssignee(task)) && (
                              <button
                                type="button"
                                className="sprint-card-backlog-button"
                                onClick={() => moveToBacklog(task)}
                                disabled={movingToBacklogId === task._id}
                              >
                                {movingToBacklogId === task._id
                                  ? "Moving…"
                                  : "↩ Back to backlog"}
                              </button>
                            )}

                            {/* Managers and admins can delete any unfinished task.
                                Developers and testers can only ask for a task that is still in To Do. */}
                            {(canReassign ? task.status !== "done" : task.status === "todo") && (
                              <button
                                type="button"
                                className="task-delete-button"
                                onClick={() => removeTask(task)}
                                disabled={
                                  !canReassign &&
                                  (pendingDeleteIds.has(task._id) || declinedDeleteIds.has(task._id))
                                }
                              >
                                {canReassign
                                  ? "Delete task"
                                  : declinedDeleteIds.has(task._id)
                                    ? "Deletion declined"
                                    : pendingDeleteIds.has(task._id)
                                      ? "Deletion requested"
                                      : "Request deletion"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
