import { useState } from "react";
import {
  STORY_POINT_SCALE,
  estimateStoryPoints,
  type StoryPointEstimate,
  type StoryPointValue,
} from "../../api/ai";
import type { TaskPriority } from "../../api/tasks";
import "./StoryPointEstimator.css";

interface StoryPointEstimatorProps {
  projectId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  /** Existing task being re-estimated (omit for a new task draft). */
  taskId?: string;
  /** Value currently stored on an existing task, shown next to the AI suggestion. */
  savedStoryPoints?: number;
  /** Button text, e.g. "Use Estimate" or "Apply Estimate". */
  applyLabel: string;
  /**
   * Optional confirmation shown after the value has been applied. Omit it when
   * the parent already displays the chosen value (e.g. the create-task form).
   */
  appliedText?: (storyPoints: StoryPointValue) => string;
  /** Called ONLY when the user clicks the apply button. */
  onApply: (storyPoints: StoryPointValue) => void | Promise<void>;
}

interface EstimateResult {
  estimate: StoryPointEstimate;
  /** Task details the estimate was made for, to detect later edits. */
  inputKey: string;
}

/**
 * Requests an AI story-point suggestion and lets the user accept it or pick
 * another Fibonacci value. Requesting an estimate never changes any task —
 * only the apply button calls `onApply`.
 */
export default function StoryPointEstimator({
  projectId,
  title,
  description,
  priority,
  taskId,
  savedStoryPoints,
  applyLabel,
  appliedText,
  onApply,
}: StoryPointEstimatorProps) {
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [selected, setSelected] = useState<StoryPointValue>(0);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const trimmedTitle = title.trim();
  const trimmedDescription = (description ?? "").trim();
  const inputKey = JSON.stringify([trimmedTitle, trimmedDescription, priority ?? ""]);
  const isStale = result !== null && result.inputKey !== inputKey;

  const requestEstimate = async () => {
    if (!trimmedTitle || loading) return;

    const keyAtRequest = inputKey;
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const estimate = await estimateStoryPoints({
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        priority,
        project: projectId,
        taskId,
      });
      setResult({ estimate, inputKey: keyAtRequest });
      setSelected(estimate.storyPoints);
    } catch (err) {
      setResult(null);
      setError(readError(err, "AI estimate failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setError("");

    try {
      await onApply(selected);
      setNotice(appliedText ? appliedText(selected) : "");
      setResult(null);
    } catch (err) {
      setError(readError(err, "Failed to apply story points."));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="sp-estimator">
      <button
        type="button"
        className="sp-estimate-button"
        onClick={requestEstimate}
        disabled={!trimmedTitle || loading || applying}
        title={trimmedTitle ? undefined : "Enter a task title first"}
      >
        {loading
          ? "Estimating…"
          : result
            ? "✨ Re-estimate with AI"
            : "✨ Estimate with AI"}
      </button>

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}

      {notice && !result && <p className="sp-notice">✓ {notice}</p>}

      {result && (
        <div className="sp-panel">
          <p className="sp-estimate">
            AI Story Point Estimate: <strong>{result.estimate.storyPoints}</strong>
          </p>

          <p className="sp-reason">
            <span>Reason:</span> {result.estimate.reasoning}
          </p>

          {savedStoryPoints !== undefined && (
            <p className="sp-saved">
              Currently saved:{" "}
              {savedStoryPoints > 0 ? `${savedStoryPoints} pts` : "0 pts / not estimated"}
            </p>
          )}

          {isStale && (
            <p className="sp-stale">
              The task details changed after this estimate. Re-estimate to be sure.
            </p>
          )}

          <label className="sp-select-label">
            Story points to use
            <select
              className="sp-select"
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value) as StoryPointValue)}
              disabled={applying}
            >
              {STORY_POINT_SCALE.map((value) => (
                <option key={value} value={value}>
                  {value}
                  {value === result.estimate.storyPoints ? " (AI suggestion)" : ""}
                </option>
              ))}
            </select>
          </label>

          {selected !== result.estimate.storyPoints && (
            <p className="sp-override">
              You are overriding the AI suggestion of {result.estimate.storyPoints}.
            </p>
          )}

          <div className="sp-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setResult(null)}
              disabled={applying}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={apply}
              disabled={applying}
            >
              {applying ? "Saving…" : `${applyLabel} (${selected} pts)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Extracts a readable message from api()/fetch errors (Nest returns JSON bodies). */
function readError(err: unknown, fallback: string): string {
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