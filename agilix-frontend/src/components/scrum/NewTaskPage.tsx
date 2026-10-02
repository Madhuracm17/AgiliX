import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getSprints, type Sprint } from "../../api/sprints";
import { useAuth } from "../../auth/auth-context";
import { useProjectPeople } from "../team/useProjectPeople";
import {
  TASK_TYPES,
  addTaskToSprint,
  createTask,
  type TaskPriority,
  type TaskType,
} from "../../api/tasks";
import type { StoryPointValue } from "../../api/ai";
import StoryPointEstimator from "../ai/StoryPointEstimator";
import PriorityRecommender from "../ai/PriorityRecommender";
import { canEditTaskPlan, readError, sprintLabel } from "./taskDisplay";
import "./scrum.css";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

type SprintChoice = "current" | "backlog";

/**
 * New Task (Figma "New Task" screen). Task details on the left; the
 * existing AI story-point estimator and priority recommender on the right.
 * "Current" puts the new task straight into the active sprint.
 */
export default function NewTaskPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  // Admins and managers assign tasks to team members. Developers and testers
  // create tasks for themselves (or leave them unassigned).
  const canAssignOthers = canEditTaskPlan(user.role);
  const people = useProjectPeople(canAssignOthers ? projectId : undefined);

  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [allSprints, setAllSprints] = useState<Sprint[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [type, setType] = useState<TaskType | "">("");
  const [assignee, setAssignee] = useState(canAssignOthers ? "" : user._id);
  const [sprintChoice, setSprintChoice] = useState<SprintChoice>(
    searchParams.get("sprint") === "current" ? "current" : "backlog"
  );
  // Story points chosen via the AI estimator; null = not set (saved as 0).
  const [storyPoints, setStoryPoints] = useState<StoryPointValue | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    getSprints(projectId)
      .then((sprintData) => {
        setAllSprints(sprintData);
        setActiveSprint(sprintData.find((s) => s.status === "active") ?? null);
      })
      .catch((err) => setError(readError(err, "Failed to load the form data")));
  }, [projectId]);

  // Without an active sprint the task can only go to the backlog.
  const goesToSprint = sprintChoice === "current" && activeSprint !== null;

  const leave = () =>
    navigate(`/projects/${projectId}/${goesToSprint ? "sprints" : "backlog"}`);

  const submit = async () => {
    if (!projectId) return;
    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }

    try {
      setCreating(true);
      setError("");
      const task = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        project: projectId,
        priority,
        assignee: assignee || undefined,
        storyPoints: storyPoints ?? undefined,
        type: type || undefined,
      });

      if (goesToSprint && activeSprint) {
        await addTaskToSprint(task._id, activeSprint._id);
      }

      leave();
    } catch (err) {
      setError(readError(err, "Failed to create task"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="scrum-page">
      <div className="page-header">
        <div>
          <p className="eyebrow breadcrumb-link" onClick={leave}>
            ← Back
          </p>
          <h1>New Task</h1>
        </div>
      </div>

      <div className="form-card new-task">
        <h2>Task Details</h2>

        <div className="new-task-grid">
          <div className="new-task-fields">
            <label htmlFor="new-task-title">Title</label>
            <input
              id="new-task-title"
              type="text"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label htmlFor="new-task-description">Description</label>
            <textarea
              id="new-task-description"
              placeholder="Task description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <aside className="new-task-ai">
            <p className="new-task-ai-title">AI help</p>
            <p className="new-task-ai-points">
              Story points:{" "}
              {storyPoints === null ? (
                <span>not set (saved as 0)</span>
              ) : (
                <>
                  <strong>{storyPoints} pts</strong>{" "}
                  <button
                    type="button"
                    className="scrum-inline-link"
                    onClick={() => setStoryPoints(null)}
                  >
                    Clear
                  </button>
                </>
              )}
            </p>

            {projectId && (
              <StoryPointEstimator
                projectId={projectId}
                title={title}
                description={description}
                priority={priority}
                applyLabel="Use Estimate"
                onApply={(points) => setStoryPoints(points)}
              />
            )}

            {projectId && (
              <PriorityRecommender
                projectId={projectId}
                title={title}
                description={description}
                currentPriority={priority}
                applyLabel="Use Recommendation"
                onApply={(value) => setPriority(value)}
              />
            )}
          </aside>

          <div className="new-task-fields">
            <span className="new-task-label">Priority</span>
            <div className="new-task-pills" role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`new-task-pill priority-${p.value} ${
                    priority === p.value ? "selected" : ""
                  }`}
                  aria-pressed={priority === p.value}
                  onClick={() => setPriority(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label htmlFor="new-task-type">Type</label>
            <select
              id="new-task-type"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType | "")}
            >
              <option value="">Select type</option>
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="new-task-fields">
            <span className="new-task-label">Sprint</span>
            <div className="new-task-pills" role="group" aria-label="Sprint">
              <button
                type="button"
                className={`new-task-pill ${goesToSprint ? "selected" : ""}`}
                aria-pressed={goesToSprint}
                disabled={!activeSprint}
                title={activeSprint ? sprintLabel(activeSprint, allSprints) : "No active sprint"}
                onClick={() => setSprintChoice("current")}
              >
                Current{activeSprint ? ` · ${sprintLabel(activeSprint, allSprints)}` : ""}
              </button>
              <button
                type="button"
                className={`new-task-pill ${!goesToSprint ? "selected" : ""}`}
                aria-pressed={!goesToSprint}
                onClick={() => setSprintChoice("backlog")}
              >
                Backlog
              </button>
            </div>
            {!activeSprint && (
              <p className="new-task-hint">No active sprint, so the task goes to the backlog.</p>
            )}

            <label htmlFor="new-task-assignee">Assignee</label>
            <select
              id="new-task-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {canAssignOthers ? (
                <>
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person._id} value={person._id}>
                      {person.name}
                      {person._id === user._id ? " (me)" : ""}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value={user._id}>Me ({user.name})</option>
                  <option value="">Unassigned</option>
                </>
              )}
            </select>
          </div>
        </div>

        {error && (
          <p className="new-task-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button className="secondary-button" onClick={leave}>
            Cancel
          </button>
          <button className="primary-button" onClick={submit} disabled={creating}>
            {creating ? "Creating..." : "Create New Task →"}
          </button>
        </div>
      </div>
    </div>
  );
}
