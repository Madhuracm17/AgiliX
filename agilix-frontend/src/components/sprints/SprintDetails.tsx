import { useState } from "react";
import { completeSprint, startSprint, updateSprint } from "../../api/sprints";
import SprintStatusBadge from "./SprintStatusBadge";
import "./SprintDetails.css";

/** The sprint fields this component needs (works with App.tsx's Sprint type). */
export interface SprintSummary {
  _id: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface SprintDetailsProps {
  sprint: SprintSummary;
  /** Tasks in this sprint that are not done (they go back to the backlog on completion). */
  unfinishedCount: number;
  /** Called after the sprint was started, completed or edited, to reload the page data. */
  onChanged: () => void | Promise<void>;
}

/**
 * Details bar for the selected sprint: goal, dates, status and the
 * Start / Complete / Edit actions.
 */
export default function SprintDetails({ sprint, unfinishedCount, onChanged }: SprintDetailsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const isCompleted = sprint.status === "completed";

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      await onChanged();
    } catch (err) {
      setError(readError(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () =>
    run(async () => {
      await startSprint(sprint._id);
      return `${sprint.name} started.`;
    });

  const handleComplete = () => {
    const warning =
      unfinishedCount > 0
        ? `\n\n${unfinishedCount} unfinished task${unfinishedCount === 1 ? "" : "s"} will go back to the backlog.`
        : "";
    if (!window.confirm(`Complete ${sprint.name}?${warning}`)) return;

    run(async () => {
      const result = await completeSprint(sprint._id);
      const moved = result.movedToBacklog;
      return moved > 0
        ? `${sprint.name} completed. ${moved} unfinished task${moved === 1 ? "" : "s"} moved back to the backlog.`
        : `${sprint.name} completed.`;
    });
  };

  const openEdit = () => {
    setName(sprint.name);
    setGoal(sprint.goal ?? "");
    setStartDate(toDateInput(sprint.startDate));
    setEndDate(toDateInput(sprint.endDate));
    setError("");
    setNotice("");
    setEditing(true);
  };

  const saveEdit = () => {
    if (!name.trim() || !startDate || !endDate) {
      setError("Name, start date and end date are required.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    run(async () => {
      await updateSprint(sprint._id, { name: name.trim(), goal: goal.trim(), startDate, endDate });
      setEditing(false);
      return "Sprint updated.";
    });
  };

  return (
    <div className="sprint-details">
      <div className="sprint-details-header">
        <div className="sprint-details-info">
          <div className="sprint-details-title">
            <h2>{sprint.name}</h2>
            <SprintStatusBadge status={sprint.status} />
          </div>
          <p className="sprint-details-dates">
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </p>
          <p className="sprint-details-goal">
            {sprint.goal ? (
              <>
                <strong>Goal:</strong> {sprint.goal}
              </>
            ) : (
              <span className="sprint-details-muted">No sprint goal set.</span>
            )}
          </p>
        </div>

        {!isCompleted && !editing && (
          <div className="sprint-details-actions">
            <button type="button" className="secondary-button" onClick={openEdit} disabled={busy}>
              Edit
            </button>
            {sprint.status === "planned" && (
              <button type="button" className="primary-button" onClick={handleStart} disabled={busy}>
                {busy ? "Starting…" : "Start Sprint"}
              </button>
            )}
            {sprint.status === "active" && (
              <button type="button" className="primary-button" onClick={handleComplete} disabled={busy}>
                {busy ? "Completing…" : "Complete Sprint"}
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="sprint-edit-form">
          <label htmlFor="sprint-edit-name">Sprint name</label>
          <input id="sprint-edit-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="sprint-edit-goal">Sprint goal</label>
          <textarea
            id="sprint-edit-goal"
            placeholder="What should this sprint achieve?"
            value={goal}
            maxLength={500}
            onChange={(e) => setGoal(e.target.value)}
          />

          <div className="sprint-edit-dates">
            <div>
              <label htmlFor="sprint-edit-start">Start date</label>
              <input
                id="sprint-edit-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="sprint-edit-end">End date</label>
              <input
                id="sprint-edit-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={saveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="sprint-details-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="sprint-details-notice">✓ {notice}</p>}
    </div>
  );
}

/** Dates are stored as UTC midnight, so format them in UTC to avoid showing the day before. */
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-10-01T00:00:00.000Z" → "2026-10-01" for <input type="date">. */
function toDateInput(value: string): string {
  return value ? value.slice(0, 10) : "";
}

/** Turns api() errors (Nest JSON bodies) into a readable message. */
function readError(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  try {
    const body = JSON.parse(err.message) as { message?: unknown };
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    return typeof message === "string" && message ? message : fallback;
  } catch {
    return err.message;
  }
}