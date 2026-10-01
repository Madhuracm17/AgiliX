import { useState, type ReactNode } from "react";
import { suggestTasks, type TaskSuggestion } from "../../api/ai";
// Reuses the AI panel styles from the story-point estimator (sp-* classes)
// and the app's existing priority-badge colours from index.css.
import "./StoryPointEstimator.css";
import "./TaskSuggestions.css";

interface TaskSuggestionsProps {
  projectId: string;
  /**
   * Optional buttons shown under each suggestion (e.g. "Add to Sprint" /
   * "Add to Backlog"). The AI request itself never creates a task — only
   * these buttons do, when the user clicks them.
   */
  renderActions?: (suggestion: TaskSuggestion) => ReactNode;
}

/**
 * "AI Task Suggestions" section: asks the AI for next-task ideas derived from
 * the project's current backlog. The AI call is read-only — a task is only
 * created when the user clicks one of the buttons passed in renderActions.
 */
export default function TaskSuggestions({
  projectId,
  renderActions,
}: TaskSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const result = await suggestTasks(projectId);
      setSuggestions(result.suggestions);
    } catch (err) {
      setSuggestions(null);
      setError(readError(err, "AI task suggestions failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="task-suggestions">
      <div className="task-suggestions-header">
        <div>
          <h2>AI Task Suggestions</h2>
          <p>Ideas for next tasks, based only on the tasks in this backlog.</p>
        </div>

        <button
          type="button"
          className="sp-estimate-button"
          onClick={generate}
          disabled={loading}
        >
          {loading
            ? "Generating…"
            : suggestions
              ? "✨ Generate Again"
              : "✨ Generate Suggestions"}
        </button>
      </div>

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}

      {suggestions && (
        <div className="task-suggestions-list">
          {suggestions.map((suggestion, index) => (
            <div className="sp-panel task-suggestion" key={`${index}-${suggestion.title}`}>
              <div className="task-suggestion-title">
                <strong>{suggestion.title}</strong>
                <span className={`priority-badge priority-${suggestion.priority}`}>
                  {suggestion.priority}
                </span>
              </div>
              <p>{suggestion.description}</p>
              <p className="task-suggestion-source">
                Based on: <strong>{suggestion.basedOn}</strong>
              </p>
              <p className="sp-reason">
                <span>Why:</span> {suggestion.reasoning}
              </p>
              {renderActions?.(suggestion)}
            </div>
          ))}
          <div className="task-suggestions-actions">
            <button
              type="button"
              className="sp-link-button"
              onClick={() => setSuggestions(null)}
            >
              Dismiss
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