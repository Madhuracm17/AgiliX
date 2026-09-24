import { useState } from "react";
import {
  recommendPriority,
  type PriorityRecommendation,
} from "../../api/ai";
import type { TaskPriority } from "../../api/tasks";
// Reuses the AI panel styles from the story-point estimator (sp-* classes)
// and the app's existing priority-badge colours from index.css.
import "./StoryPointEstimator.css";

interface PriorityRecommenderProps {
  projectId: string;
  title: string;
  description?: string;
  /** Existing task the recommendation is for (omit for a new task draft). */
  taskId?: string;
  /** Priority currently set, shown for comparison only — never sent to the AI. */
  currentPriority?: TaskPriority;
  /** Button text, e.g. "Use Recommendation" or "Apply Recommendation". */
  applyLabel: string;
  /**
   * Optional confirmation shown after the recommendation has been applied. Omit it
   * when the parent already displays the chosen value (e.g. the create-task form).
   */
  appliedText?: (priority: TaskPriority) => string;
  /** Called ONLY when the user clicks the apply button. */
  onApply: (priority: TaskPriority) => void | Promise<void>;
}

interface RecommendationResult {
  recommendation: PriorityRecommendation;
  /** Task details the recommendation was made for, to detect later edits. */
  inputKey: string;
}

/**
 * Requests an AI priority recommendation and lets the user apply or dismiss it.
 * Requesting a recommendation never changes any task — only the apply button
 * calls `onApply`.
 */
export default function PriorityRecommender({
  projectId,
  title,
  description,
  taskId,
  currentPriority,
  applyLabel,
  appliedText,
  onApply,
}: PriorityRecommenderProps) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const trimmedTitle = title.trim();
  const trimmedDescription = (description ?? "").trim();
  // Priority is not an input to the recommendation, so only title and description count.
  const inputKey = JSON.stringify([trimmedTitle, trimmedDescription]);
  const isStale = result !== null && result.inputKey !== inputKey;

  const requestRecommendation = async () => {
    if (!trimmedTitle || loading) return;

    const keyAtRequest = inputKey;
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const recommendation = await recommendPriority({
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        project: projectId,
        taskId,
      });
      setResult({ recommendation, inputKey: keyAtRequest });
    } catch (err) {
      setResult(null);
      setError(readError(err, "AI priority recommendation failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    const priority = result.recommendation.priority;

    setApplying(true);
    setError("");

    try {
      await onApply(priority);
      setNotice(appliedText ? appliedText(priority) : "");
      setResult(null);
    } catch (err) {
      setError(readError(err, "Failed to apply priority."));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="sp-estimator">
      <button
        type="button"
        className="sp-estimate-button"
        onClick={requestRecommendation}
        disabled={!trimmedTitle || loading || applying}
        title={trimmedTitle ? undefined : "Enter a task title first"}
      >
        {loading
          ? "Recommending…"
          : result
            ? "✨ Re-recommend with AI"
            : "✨ Recommend Priority with AI"}
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
            AI Priority Recommendation:{" "}
            <span
              className={`priority-badge priority-${result.recommendation.priority}`}
            >
              {result.recommendation.priority}
            </span>
          </p>

          <p className="sp-reason">
            <span>Reason:</span> {result.recommendation.reasoning}
          </p>

          {currentPriority && (
            <p className="sp-saved">Currently: {currentPriority}</p>
          )}

          {isStale && (
            <p className="sp-stale">
              The task details changed after this recommendation. Re-recommend to be sure.
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
              {applying ? "Saving…" : `${applyLabel} (${result.recommendation.priority})`}
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