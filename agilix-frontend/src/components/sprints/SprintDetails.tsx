import { useState } from "react";
import { completeSprint, startSprint, updateSprint } from "../../api/sprints";
import SprintStatusBadge from "./SprintStatusBadge";
import { useAuth } from "../../auth/auth-context";
import { canManageSprints, sprintLabel } from "../scrum/taskDisplay";
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
  /** All sprints of the project (used to offer planned sprints for unfinished work). */
  allSprints: SprintSummary[];
  /** Tasks in this sprint that are not done. */
  unfinishedCount: number;
  /** Called after the sprint was started, completed or edited, to reload the page data. */
  onChanged: () => void | Promise<void>;
}

const BACKLOG = "backlog";

/**
 * Details bar for the selected sprint: goal, dates, status and the
 * Start / Complete / Edit actions.
 */
export default function SprintDetails({
  sprint,
  allSprints,
  unfinishedCount,
  onChanged,
}: SprintDetailsProps) {
  const { user } = useAuth();
  // Only admins and managers start, complete or edit sprints (also enforced by the backend).
  const canManage = canManageSprints(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // "Complete sprint" box: where unfinished tasks should go.
  const [completing, setCompleting] = useState(false);
  const [destination, setDestination] = useState(BACKLOG);

  const isCompleted = sprint.status === "completed";
  const plannedSprints = allSprints.filter(
    (s) => s.status === "planned" && s._id !== sprint._id
  );

  // "Sprint 2 (Login page)" — sprint number by start date + the sprint's name.
  const label = (s: SprintSummary) => sprintLabel(s, allSprints);
  const title = label(sprint);

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

  // A planned sprint cannot start before its start date (the server checks this too).
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const startsLater = dayKey(new Date(sprint.startDate)) > dayKey(new Date());
  const startDateText = new Date(sprint.startDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const handleStart = () =>
    run(async () => {
      await startSprint(sprint._id);
      return `${title} started.`;
    });

  const openComplete = () => {
    setDestination(BACKLOG);
    setError("");
    setNotice("");
    setCompleting(true);
  };

  const confirmComplete = () =>
    run(async () => {
      const target = destination === BACKLOG ? undefined : destination;
      const result = await completeSprint(sprint._id, target);
      setCompleting(false);

      const moved = result.movedCount;
      if (moved === 0) return `${title} completed.`;

      const tasks = `${moved} unfinished task${moved === 1 ? "" : "s"}`;
      const movedTo = allSprints.find((s) => s._id === result.movedToSprint?._id);
      return result.movedToSprint
        ? `${title} completed. ${tasks} moved to ${movedTo ? label(movedTo) : result.movedToSprint.name}.`
        : `${title} completed. ${tasks} moved back to the backlog.`;
    });

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
            <h2>{title}</h2>
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

        {canManage && !isCompleted && !editing && !completing && (
          <div className="sprint-details-actions">
            <button type="button" className="secondary-button" onClick={openEdit} disabled={busy}>
              Edit
            </button>
            {sprint.status === "planned" && startsLater && (
              <span className="sprint-details-muted">Can start on {startDateText}</span>
            )}
            {sprint.status === "planned" && (
              <button
                type="button"
                className="primary-button"
                onClick={handleStart}
                disabled={busy || startsLater}
                title={startsLater ? `This sprint can start on ${startDateText}` : undefined}
              >
                {busy ? "Starting…" : "Start Sprint"}
              </button>
            )}
            {sprint.status === "active" && (
              <button type="button" className="primary-button" onClick={openComplete} disabled={busy}>
                Complete Sprint
              </button>
            )}
          </div>
        )}
      </div>

      {completing && (
        <div className="sprint-complete-box">
          <h3>Complete {title}</h3>

          {unfinishedCount > 0 ? (
            <>
              <p>
                {unfinishedCount} task{unfinishedCount === 1 ? " isn't" : "s aren't"} done.
                Where should {unfinishedCount === 1 ? "it" : "they"} go?
              </p>

              <label className="sprint-complete-option">
                <input
                  type="radio"
                  name={`complete-destination-${sprint._id}`}
                  value={BACKLOG}
                  checked={destination === BACKLOG}
                  onChange={() => setDestination(BACKLOG)}
                />
                Back to the backlog
              </label>

              {plannedSprints.map((s) => (
                <label className="sprint-complete-option" key={s._id}>
                  <input
                    type="radio"
                    name={`complete-destination-${sprint._id}`}
                    value={s._id}
                    checked={destination === s._id}
                    onChange={() => setDestination(s._id)}
                  />
                  Move to <strong>{label(s)}</strong> (planned)
                </label>
              ))}

              {plannedSprints.length === 0 && (
                <p className="sprint-details-muted sprint-complete-hint">
                  Tip: create a planned sprint first if you want to move them straight into
                  the next sprint.
                </p>
              )}
            </>
          ) : (
            <p>All tasks in this sprint are done. Complete it now?</p>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setCompleting(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={confirmComplete} disabled={busy}>
              {busy ? "Completing…" : "Complete Sprint"}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="sprint-edit-form">
          <label htmlFor="sprint-edit-name">Sprint name</label>
          <input
            id="sprint-edit-name"
            type="text"
            placeholder="e.g. Login page"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

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