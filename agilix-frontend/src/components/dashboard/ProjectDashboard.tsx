import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getTasks, type Task } from "../../api/tasks";
import { getSprints, type Sprint } from "../../api/sprints";
import { getSprintRisk, type SprintRisk } from "../../api/ai";
import { useAuth } from "../../auth/auth-context";
import SprintProgress from "../sprints/SprintProgress";
import {
  daysLeft,
  greeting,
  priorityLabel,
  readError,
  sameId,
  timeAgo,
} from "../scrum/taskDisplay";
import "./ProjectDashboard.css";

interface ProjectDashboardProps {
  project: { _id: string; name: string; description?: string };
}

interface Activity {
  key: string;
  text: string;
  at: string;
}

/**
 * Scrum project dashboard (Figma "Dashboard" screen): task totals,
 * sprint health for the active sprint, recent activity and the logged-in
 * user's own tasks. The AI confidence figure comes from the existing
 * AI sprint-risk endpoint and is only requested when the user asks.
 */
export default function ProjectDashboard({ project }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectId = project._id;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [risk, setRisk] = useState<SprintRisk | null>(null);
  const [checkingRisk, setCheckingRisk] = useState(false);
  const [riskError, setRiskError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const [taskData, sprintData] = await Promise.all([
          getTasks(projectId),
          getSprints(projectId),
        ]);
        if (cancelled) return;
        setTasks(taskData);
        setSprints(sprintData);
      } catch (err) {
        if (!cancelled) setError(readError(err, "Failed to load the dashboard"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const activeSprint = sprints.find((s) => s.status === "active") ?? null;

  const sprintTasks = useMemo(
    () =>
      activeSprint ? tasks.filter((t) => sameId(t.sprint, activeSprint._id)) : [],
    [tasks, activeSprint]
  );

  const counts = {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    inProgress: tasks.filter(
      (t) => t.status === "in_progress" || t.status === "review"
    ).length,
  };

  const sprintDone = sprintTasks.filter((t) => t.status === "done");
  const sprintActive = sprintTasks.filter(
    (t) => t.status === "in_progress" || t.status === "review"
  );
  const points = (list: Task[]) =>
    list.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);

  const activity = useMemo(() => buildActivity(tasks, sprints), [tasks, sprints]);

  // My tasks: in the active sprint if there is one, otherwise anywhere in
  // the project. Unfinished first, highest priority first.
  const myTasks = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return tasks
      .filter((t) => sameId(t.assignee, user._id))
      .filter((t) => !activeSprint || sameId(t.sprint, activeSprint._id))
      .sort((a, b) => {
        const doneA = a.status === "done" ? 1 : 0;
        const doneB = b.status === "done" ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        return rank[a.priority] - rank[b.priority];
      })
      .slice(0, 6);
  }, [tasks, user._id, activeSprint]);

  const checkConfidence = async () => {
    if (!activeSprint || checkingRisk) return;
    try {
      setCheckingRisk(true);
      setRiskError("");
      setRisk(await getSprintRisk(activeSprint._id));
    } catch (err) {
      setRisk(null);
      setRiskError(readError(err, "AI prediction failed. Please try again."));
    } finally {
      setCheckingRisk(false);
    }
  };

  const go = (path: string) => navigate(`/projects/${projectId}${path}`);

  return (
    <div className="dash">
      <div className="page-header">
        <div>
          <p className="eyebrow">DASHBOARD · {project.name.toUpperCase()}</p>
          <h1>Dashboard</h1>
          <p className="page-description">
            {greeting()}, {user.name}!
          </p>
        </div>

        <button className="secondary-button" onClick={() => navigate("/projects")}>
          All Projects
        </button>
      </div>

      <nav className="dash-links" aria-label="Project pages">
        <button className="primary-button" onClick={() => go("/sprints")}>
          Scrum Board
        </button>
        <button className="secondary-button" onClick={() => go("/backlog")}>
          Product Backlog
        </button>
        <button className="secondary-button" onClick={() => go("/ai-insights")}>
          AI Insights
        </button>
        <button className="secondary-button" onClick={() => go("/reports")}>
          Reports
        </button>
        <button className="secondary-button" onClick={() => navigate("/team")}>
          Team
        </button>
      </nav>

      {loading && (
        <div className="empty-state">
          <h2>Loading dashboard...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load dashboard</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="dash-stats">
            <StatTile label="Total Task" value={counts.total} />
            <StatTile label="Completed" value={counts.done} />
            <StatTile label="In Progress" value={counts.inProgress} />
          </div>

          <section className="dash-panel">
            <div className="dash-panel-header">
              <h2>Sprint Health</h2>
              {activeSprint && (
                <span className="dash-sprint-name">{activeSprint.name}</span>
              )}
            </div>

            {!activeSprint ? (
              <div className="dash-empty">
                <p>No active sprint right now.</p>
                <button className="secondary-button" onClick={() => go("/sprints")}>
                  Open Scrum Board
                </button>
              </div>
            ) : (
              <>
                {activeSprint.goal && (
                  <p className="dash-goal">Goal: {activeSprint.goal}</p>
                )}

                {sprintTasks.length > 0 ? (
                  <SprintProgress
                    totalTasks={sprintTasks.length}
                    doneTasks={sprintDone.length}
                    inProgressTasks={sprintActive.length}
                    totalStoryPoints={points(sprintTasks)}
                    completedStoryPoints={points(sprintDone)}
                    inProgressStoryPoints={points(sprintActive)}
                  />
                ) : (
                  <p className="dash-muted">
                    No tasks in this sprint yet. Add some from the Product Backlog.
                  </p>
                )}

                <div className="dash-stats">
                  <StatTile
                    label="Remaining Task"
                    value={sprintTasks.length - sprintDone.length}
                  />
                  <StatTile label="Days Left" value={daysLeft(activeSprint.endDate)} />
                  <div className="dash-stat">
                    <span>Confidence</span>
                    {risk ? (
                      <strong className={`dash-risk dash-risk-${risk.risk}`}>
                        {risk.completionForecastPercent}%
                      </strong>
                    ) : (
                      <button
                        type="button"
                        className="dash-link dash-check"
                        onClick={checkConfidence}
                        disabled={checkingRisk}
                      >
                        {checkingRisk ? "Checking…" : "✨ Check with AI"}
                      </button>
                    )}
                  </div>
                </div>

                {risk && (
                  <p className="dash-muted">
                    <strong>AI:</strong> {risk.reasoning}{" "}
                    <button
                      type="button"
                      className="dash-link"
                      onClick={checkConfidence}
                      disabled={checkingRisk}
                    >
                      {checkingRisk ? "Checking…" : "Check again"}
                    </button>
                  </p>
                )}
                {riskError && (
                  <p className="dash-error" role="alert">
                    {riskError}
                  </p>
                )}
              </>
            )}

            <div className="dash-columns">
              <div className="dash-card">
                <h3>Recent Activity</h3>
                {activity.length === 0 ? (
                  <p className="dash-muted">Nothing has happened yet.</p>
                ) : (
                  <ul className="dash-activity">
                    {activity.map((item) => (
                      <li key={item.key}>
                        {item.text} <span>— {timeAgo(item.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <h3>My Tasks Today</h3>
                {myTasks.length === 0 ? (
                  <p className="dash-muted">
                    {activeSprint
                      ? "No tasks assigned to you in this sprint."
                      : "No tasks assigned to you yet."}
                  </p>
                ) : (
                  <ul className="dash-my-tasks">
                    {myTasks.map((task) => (
                      <li key={task._id}>
                        <div>
                          <strong className={task.status === "done" ? "dash-done" : ""}>
                            {task.title}
                          </strong>
                          <span>
                            {activeSprint
                              ? `Sprint ends in ${daysLeft(activeSprint.endDate)} days`
                              : "Not in a sprint"}
                            {" · "}
                            {task.storyPoints ?? 0} pts
                          </span>
                        </div>
                        {task.status === "done" ? (
                          <span className="dash-badge dash-badge-done">Done</span>
                        ) : (
                          <span className={`dash-badge dash-badge-${task.priority}`}>
                            {priorityLabel(task.priority)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="dash-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * There is no activity log in the database, so recent activity is built
 * from the timestamps tasks and sprints already have.
 */
function buildActivity(tasks: Task[], sprints: Sprint[]): Activity[] {
  const items: Activity[] = [];

  for (const task of tasks) {
    if (!task.updatedAt) continue;
    const created = task.createdAt && task.createdAt === task.updatedAt;
    let text: string;
    if (task.status === "done") text = `Completed “${task.title}”`;
    else if (created) text = `Created “${task.title}”`;
    else if (task.status === "review") text = `Moved “${task.title}” to Review`;
    else if (task.status === "in_progress") text = `Working on “${task.title}”`;
    else text = `Updated “${task.title}”`;
    items.push({ key: `t-${task._id}`, text, at: task.updatedAt });
  }

  for (const sprint of sprints) {
    if (sprint.completedAt) {
      items.push({
        key: `sc-${sprint._id}`,
        text: `${sprint.name} completed`,
        at: sprint.completedAt,
      });
    }
    if (sprint.startedAt) {
      items.push({
        key: `ss-${sprint._id}`,
        text: `${sprint.name} started`,
        at: sprint.startedAt,
      });
    }
    if (sprint.createdAt) {
      items.push({
        key: `sp-${sprint._id}`,
        text: `${sprint.name} planned`,
        at: sprint.createdAt,
      });
    }
  }

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
}
