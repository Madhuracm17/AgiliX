import "./SprintDetails.css";

interface SprintProgressProps {
  totalTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
  inProgressStoryPoints: number;
}

/**
 * Progress bar for a sprint: solid = done, light = in progress.
 * Uses story points when the tasks are estimated, otherwise task counts.
 * Only DONE work counts towards the percentage (standard Scrum).
 */
export default function SprintProgress({
  totalTasks,
  doneTasks,
  inProgressTasks,
  totalStoryPoints,
  completedStoryPoints,
  inProgressStoryPoints,
}: SprintProgressProps) {
  const byPoints = totalStoryPoints > 0;
  const total = byPoints ? totalStoryPoints : totalTasks;
  const done = byPoints ? completedStoryPoints : doneTasks;
  const inProgress = byPoints ? inProgressStoryPoints : inProgressTasks;
  const unit = byPoints ? "story points" : "tasks";

  const donePercent = total > 0 ? Math.round((done / total) * 100) : 0;
  const inProgressPercent =
    total > 0 ? Math.min(100 - donePercent, Math.round((inProgress / total) * 100)) : 0;

  return (
    <div className="sprint-progress">
      <div className="sprint-progress-label">
        <span>Sprint progress</span>
        <strong>
          {donePercent}% done · {done}/{total} {unit}
          {inProgress > 0 && ` · ${inProgress} in progress`}
        </strong>
      </div>
      <div
        className="sprint-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={donePercent}
        aria-label="Sprint progress"
      >
        <div className="sprint-progress-fill" style={{ width: `${donePercent}%` }} />
        <div
          className="sprint-progress-fill-in-progress"
          style={{ width: `${inProgressPercent}%` }}
        />
      </div>
      <div className="sprint-progress-legend">
        <span>
          <i className="sprint-legend-dot sprint-legend-done" /> Done
        </span>
        <span>
          <i className="sprint-legend-dot sprint-legend-in-progress" /> In progress
        </span>
      </div>
    </div>
  );
}