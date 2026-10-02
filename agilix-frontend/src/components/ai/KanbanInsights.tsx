import { useState } from "react";
import {
  getKanbanInsights,
  type KanbanInsights as KanbanInsightsData,
  type KanbanStage,
} from "../../api/ai";
import { readError } from "../scrum/taskDisplay";
// Reuses the AI panel styles (sp-* classes) shared by the other AI features.
import "./StoryPointEstimator.css";
import "./KanbanInsights.css";

interface KanbanInsightsProps {
  projectId: string;
  /**
   * The board's Review setting, when the page knows it. Leave it out and the
   * backend uses the project's setting, or infers it from the task statuses.
   */
  reviewEnabled?: boolean;
}

const STAGE_LABELS: Record<KanbanStage, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const HEALTH_LABELS = {
  healthy: "Healthy",
  attention: "Needs attention",
  critical: "Critical",
} as const;

/**
 * "AI Kanban Insights" panel. Self-contained: drop it into any page of a Kanban
 * project, e.g. <KanbanInsights projectId={projectId} reviewEnabled={...} />.
 * Read-only — it never changes the board. The numbers come from the backend's
 * calculations; only the health, summary, bottlenecks and recommendations are AI.
 */
export default function KanbanInsights({ projectId, reviewEnabled }: KanbanInsightsProps) {
  const [insights, setInsights] = useState<KanbanInsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      setInsights(await getKanbanInsights(projectId, reviewEnabled));
    } catch (err) {
      setInsights(null);
      // Shows the backend's message, e.g. the 503 "AI service is temporarily unavailable…".
      setError(readError(err, "AI Kanban analysis failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const metrics = insights?.metrics;
  const stageCount = (stage: KanbanStage) =>
    !metrics
      ? 0
      : stage === "todo"
        ? metrics.todo
        : stage === "in_progress"
          ? metrics.inProgress
          : stage === "review"
            ? (metrics.review ?? 0)
            : metrics.done;

  return (
    <section className="kanban-insights" aria-label="AI Kanban Insights">
      <div className="kanban-insights-header">
        <div>
          <h2>AI Kanban Insights</h2>
          <p>Board health, bottlenecks and next steps, based on the board as it is now.</p>
        </div>
        <button type="button" className="sp-estimate-button" onClick={analyze} disabled={loading}>
          {loading ? "Analyzing…" : insights ? "Analyze Again" : "Analyze Board"}
        </button>
      </div>

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}

      {insights && metrics && (
        <>
          <div className={`kanban-insights-health kanban-health-${insights.analysis.health}`}>
            <span className="kanban-insights-tag">AI</span>
            <strong>{HEALTH_LABELS[insights.analysis.health]}</strong>
            <p>{insights.analysis.summary}</p>
          </div>

          <div>
            <h3 className="kanban-insights-heading">
              Board metrics <span>calculated from current data</span>
            </h3>
            <div className="kanban-insights-stages">
              {insights.workflow.stages.map((stage, index) => (
                <div className="kanban-insights-stage" key={stage}>
                  {index > 0 && <span className="kanban-insights-arrow" aria-hidden="true">→</span>}
                  <div className="kanban-insights-stat">
                    <span>{STAGE_LABELS[stage]}</span>
                    <strong>{stageCount(stage)}</strong>
                  </div>
                </div>
              ))}
            </div>
            <ul className="kanban-insights-facts">
              <li>
                {metrics.totalTasks} tasks · {metrics.donePercent}% done · {metrics.workInProgress} in progress
                {insights.workflow.reviewEnabled ? " (incl. Review)" : ""}
              </li>
              <li>
                {metrics.priority.highNotStarted} high-priority task
                {metrics.priority.highNotStarted === 1 ? "" : "s"} not started
              </li>
              <li>{metrics.assignment.unassignedOpen} unfinished task(s) unassigned</li>
              <li>
                {metrics.staleWork.count} task(s) in progress not updated for {metrics.staleWork.thresholdDays}+ days
              </li>
              {metrics.storyPoints && (
                <li>
                  {metrics.storyPoints.done} of {metrics.storyPoints.total} story points done
                </li>
              )}
              {metrics.outsideWorkflow > 0 && (
                <li>{metrics.outsideWorkflow} task(s) have a status outside this workflow</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="kanban-insights-heading">
              Bottlenecks <span className="kanban-insights-tag">AI</span>
            </h3>
            {insights.analysis.bottlenecks.length === 0 ? (
              <p className="kanban-insights-muted">No bottlenecks found on the board right now.</p>
            ) : (
              <ul className="kanban-insights-list">
                {insights.analysis.bottlenecks.map((b, index) => (
                  <li key={`${b.stage}-${index}`}>
                    <strong>{STAGE_LABELS[b.stage]}:</strong> {b.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="kanban-insights-heading">
              Recommendations <span className="kanban-insights-tag">AI</span>
            </h3>
            <ol className="kanban-insights-list">
              {insights.analysis.recommendations.map((r, index) => (
                <li key={index}>{r}</li>
              ))}
            </ol>
          </div>

          <details className="kanban-insights-limits">
            <summary>About this analysis</summary>
            <ul>
              {insights.limitations.map((l, index) => (
                <li key={index}>{l}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}