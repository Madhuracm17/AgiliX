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
  sprintLabel,
  timeAgo,
} from "../scrum/taskDisplay";
import "./ProjectDashboard.css";

/** The AI's explanation can be long; the dashboard shows just its first sentence. */
function firstSentence(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  const match = clean.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : clean;
}

interface ProjectDashboardProps {
  /** Every project the signed-in person belongs to. */
  projects: { _id: string; name: string; methodology?: "scrum" | "kanban" }[];
}

interface Activity {
  key: string;
  text: string;
  at: string;
}

/**
 * Dashboard (Figma "Dashboard" screen), the first page after login. It adds up
 * the person's projects: task totals, sprint health for the active sprint,
 * recent activity and their own tasks. The AI confidence figure comes from the
 * existing AI sprint-risk endpoint and is only requested when the user asks.
 */
export default function ProjectDashboard({ projects }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectKey = projects.map((p) => p._id).join(",");

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
        const results = await Promise.all(
          projects.map(async (project) => ({
            tasks: await getTasks(project._id),
            sprints: await getSprints(project._id),
          })),
        );
        if (cancelled) return;
        setTasks(results.flatMap((r) => r.tasks));
        setSprints(results.flatMap((r) => r.sprints));
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
  }, [projectKey]);

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

  // My tasks: everything assigned to me in this project. Unfinished first,
  // then tasks in the active sprint, then highest priority.
  const myTasks = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const inActive = (t: Task) =>
      activeSprint && sameId(t.sprint, activeSprint._id) ? 0 : 1;
    return tasks
      .filter((t) => sameId(t.assignee, user._id))
      .sort((a, b) => {
        const doneA = a.status === "done" ? 1 : 0;
        const doneB = b.status === "done" ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        if (inActive(a) !== inActive(b)) return inActive(a) - inActive(b);
        return rank[a.priority] - rank[b.priority];
      })
      .slice(0, 6);
  }, [tasks, user._id, activeSprint]);

  // Where clicking a task in "My Tasks" goes: the board of its sprint with that task
  // highlighted, the backlog with the task open, or the Kanban board.
  const openTask = (task: Task) => {
    const projectId = typeof task.project === "string" ? task.project : String(task.project);
    const project = projects.find((p) => sameId(p._id, projectId));
    if ((project?.methodology ?? "scrum") === "kanban") {
      navigate(`/projects/${projectId}/kanban`);
    } else if (task.sprint) {
      navigate(`/projects/${projectId}/sprints?task=${task._id}`);
    } else {
      navigate(`/projects/${projectId}/backlog?task=${task._id}`);
    }
  };

  // Where a task sits, shown under its title.
  const taskPlace = (task: Task) => {
    if (activeSprint && sameId(task.sprint, activeSprint._id)) {
      return `Sprint ends in ${daysLeft(activeSprint.endDate)} days`;
    }
    const sprint = sprints.find((s) => sameId(task.sprint, s._id));
    return sprint ? label(sprint) : "In the backlog";
  };

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

  // Sprint numbers ("Sprint 2") count within one project.
  const label = (sprint: Sprint) =>
    sprintLabel(
      sprint,
      sprints.filter((s) => sameId(s.project, sprint.project)),
    );
  const projectName = (sprint: Sprint) =>
    projects.find((p) => sameId(sprint.project, p._id))?.name;

  return (
    <div className="dash">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-description">
            {greeting()}, {user.name}!
          </p>
        </div>

        <button className="secondary-button" onClick={() => navigate("/projects")}>
          All Projects
        </button>
      </div>

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
                <span className="dash-sprint-name">
                  {[projectName(activeSprint), label(activeSprint)].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>

            {!activeSprint ? (
              <div className="dash-empty">
                <p>No active sprint right now.</p>
                <button className="secondary-button" onClick={() => navigate("/projects")}>
                  Open All Projects
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
                        {checkingRisk ? "Checking…" : "Check with AI"}
                      </button>
                    )}
                  </div>
                </div>

                {risk && (
                  <p className="dash-muted dash-ai-line">
                    <span className="dash-ai-text" title={risk.reasoning}>
                      <strong>AI:</strong> {firstSentence(risk.reasoning)}
                    </span>
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
                  <p className="dash-muted">Tasks assigned to you will appear here.</p>
                ) : (
                  <ul className="dash-my-tasks">
                    {myTasks.map((task) => (
                      <li
                        key={task._id}
                        className="dash-task-link"
                        role="link"
                        tabIndex={0}
                        title="Open this task"
                        onClick={() => openTask(task)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openTask(task);
                          }
                        }}
                      >
                        <div>
                          <strong className={task.status === "done" ? "dash-done" : ""}>
                            {task.title}
                          </strong>
                          <span>
                            {taskPlace(task)}
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
        text: `${sprintLabel(sprint, sprints.filter((s) => sameId(s.project, sprint.project)))} completed`,
        at: sprint.completedAt,
      });
    }
    if (sprint.startedAt) {
      items.push({
        key: `ss-${sprint._id}`,
        text: `${sprintLabel(sprint, sprints.filter((s) => sameId(s.project, sprint.project)))} started`,
        at: sprint.startedAt,
      });
    }
    if (sprint.createdAt) {
      items.push({
        key: `sp-${sprint._id}`,
        text: `${sprintLabel(sprint, sprints.filter((s) => sameId(s.project, sprint.project)))} planned`,
        at: sprint.createdAt,
      });
    }
  }

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
}
