import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getTasks, type Task } from "../../api/tasks";
import { getSprints, type Sprint } from "../../api/sprints";
import { getSprintRisk, type SprintRisk } from "../../api/ai";
import { useAuth } from "../../auth/auth-context";
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

type DashProject = {
  _id: string;
  name: string;
  methodology?: "scrum" | "kanban";
  /** Kanban only: most tasks allowed In Progress (0 or missing = no limit). */
  wipLimit?: number;
};

interface ProjectDashboardProps {
  /** Every project the signed-in person belongs to. */
  projects: DashProject[];
}

interface Activity {
  key: string;
  text: string;
  at: string;
  /** The task this line is about, so clicking it can open the task. */
  task?: Task;
  /** The project this line belongs to (for sprint lines). */
  projectId?: string;
}

type StatusFilter = "all" | "todo" | "in_progress" | "review" | "done";
type MyTab = "open" | "done";

const STATUS_NAMES: Record<Task["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

/**
 * Status colors, the same as the Kanban flow chart (checked for color-blind
 * separation). Every bar segment also has its name in the legend and tooltip.
 */
const STATUS_COLORS: Record<Task["status"], string> = {
  todo: "#5b7fc4",
  in_progress: "#c9961a",
  review: "#8c62b8",
  done: "#3f8a4a",
};

const STATUS_ORDER: Task["status"][] = ["done", "review", "in_progress", "todo"];

/** Lets a clickable row work with Enter and Space as well as the mouse. */
const onActivate = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
};

/**
 * Dashboard, the first page after login. It adds up the person's projects,
 * Scrum and Kanban alike:
 * - status tiles that also filter the task list below,
 * - one health card per project (the active sprint for Scrum, the flow and
 *   WIP limit for Kanban), each opening its board,
 * - recent activity and the person's own tasks, each opening the task.
 * A project picker narrows everything to one project. The AI sprint estimate
 * comes from the existing sprint-risk endpoint and is only requested on click.
 */
export default function ProjectDashboard({ projects }: ProjectDashboardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Admins only oversee accounts and projects, so they get no sprint-risk estimate.
  const isAdmin = user.role === "admin";
  const projectKey = projects.map((p) => p._id).join(",");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [myTab, setMyTab] = useState<MyTab>("open");

  // AI sprint estimates, per sprint, only when someone asks.
  const [risks, setRisks] = useState<Record<string, SprintRisk>>({});
  const [checkingSprint, setCheckingSprint] = useState<string | null>(null);
  const [riskErrors, setRiskErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const results = await Promise.all(
          projects.map(async (project) => ({
            tasks: await getTasks(project._id),
            // Kanban projects have no sprints.
            sprints: project.methodology === "kanban" ? [] : await getSprints(project._id),
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

  const projectOf = (task: Task) => projects.find((p) => sameId(p._id, task.project));
  const isKanban = (p: DashProject | undefined) => (p?.methodology ?? "scrum") === "kanban";

  // Everything below follows the project picker.
  const shownProjects = projectFilter === "all" ? projects : projects.filter((p) => p._id === projectFilter);
  const shownTasks = useMemo(
    () => (projectFilter === "all" ? tasks : tasks.filter((t) => sameId(t.project, projectFilter))),
    [tasks, projectFilter],
  );
  const shownSprints = useMemo(
    () => (projectFilter === "all" ? sprints : sprints.filter((s) => sameId(s.project, projectFilter))),
    [sprints, projectFilter],
  );

  const count = (status: Task["status"]) => shownTasks.filter((t) => t.status === status).length;
  const counts = {
    all: shownTasks.length,
    todo: count("todo"),
    in_progress: count("in_progress"),
    review: count("review"),
    done: count("done"),
  };

  const activity = useMemo(() => buildActivity(shownTasks, shownSprints), [shownTasks, shownSprints]);

  const activeSprintOf = (projectId: string) =>
    sprints.find((s) => sameId(s.project, projectId) && s.status === "active") ?? null;

  // Where a task opens: its Kanban board, its sprint on the Scrum board, or the backlog.
  const openTask = (task: Task) => {
    const projectId = typeof task.project === "string" ? task.project : String(task.project);
    if (isKanban(projectOf(task))) {
      navigate(`/projects/${projectId}/kanban`);
    } else if (task.sprint) {
      navigate(`/projects/${projectId}/sprints?task=${task._id}`);
    } else {
      navigate(`/projects/${projectId}/backlog?task=${task._id}`);
    }
  };

  const openBoard = (project: DashProject) =>
    navigate(`/projects/${project._id}/${isKanban(project) ? "kanban" : "sprints"}`);

  // Where a task sits, shown under its title.
  const taskPlace = (task: Task) => {
    const project = projectOf(task);
    const name = project?.name ? `${project.name} · ` : "";
    if (isKanban(project)) return `${name}${STATUS_NAMES[task.status]}`;
    const active = project ? activeSprintOf(project._id) : null;
    if (active && sameId(task.sprint, active._id)) {
      return `${name}Sprint ends in ${daysLeft(active.endDate)} days`;
    }
    const sprint = sprints.find((s) => sameId(task.sprint, s._id));
    return `${name}${sprint ? label(sprint) : "In the backlog"}`;
  };

  // My tasks: assigned to me. Open work first (highest priority first), or what I finished.
  const myTasks = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const flow = { review: 0, in_progress: 1, todo: 2, done: 3 } as const;
    return shownTasks
      .filter((t) => sameId(t.assignee, user._id))
      .filter((t) => (myTab === "done" ? t.status === "done" : t.status !== "done"))
      .sort((a, b) =>
        myTab === "done"
          ? new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
          : flow[a.status] - flow[b.status] || rank[a.priority] - rank[b.priority],
      )
      .slice(0, 6);
  }, [shownTasks, user._id, myTab]);
  const myOpenCount = shownTasks.filter((t) => sameId(t.assignee, user._id) && t.status !== "done").length;
  const myDoneCount = shownTasks.filter((t) => sameId(t.assignee, user._id) && t.status === "done").length;

  // The task list the status tiles filter.
  const filteredTasks = useMemo(() => {
    const flow = { review: 0, in_progress: 1, todo: 2, done: 3 } as const;
    return shownTasks
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .sort((a, b) => flow[a.status] - flow[b.status])
      .slice(0, 8);
  }, [shownTasks, statusFilter]);
  const filteredTotal =
    statusFilter === "all" ? shownTasks.length : shownTasks.filter((t) => t.status === statusFilter).length;

  const checkConfidence = async (sprint: Sprint) => {
    if (checkingSprint) return;
    try {
      setCheckingSprint(sprint._id);
      setRiskErrors((prev) => ({ ...prev, [sprint._id]: "" }));
      const risk = await getSprintRisk(sprint._id);
      setRisks((prev) => ({ ...prev, [sprint._id]: risk }));
    } catch (err) {
      setRiskErrors((prev) => ({ ...prev, [sprint._id]: readError(err, "AI prediction failed. Please try again.") }));
    } finally {
      setCheckingSprint(null);
    }
  };

  // Sprint numbers ("Sprint 2") count within one project.
  const label = (sprint: Sprint) =>
    sprintLabel(
      sprint,
      sprints.filter((s) => sameId(s.project, sprint.project)),
    );

  const tiles: { key: StatusFilter; label: string; value: number }[] = [
    { key: "all", label: "Total Tasks", value: counts.all },
    { key: "todo", label: "To Do", value: counts.todo },
    { key: "in_progress", label: "In Progress", value: counts.in_progress },
    { key: "review", label: "In Review", value: counts.review },
    { key: "done", label: "Completed", value: counts.done },
  ];

  return (
    <div className="dash">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-description">
            {greeting()}, {user.name}!
          </p>
        </div>

        <div className="dash-header-actions">
          {projects.length > 1 && (
            <select
              className="dash-select"
              aria-label="Show one project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">Showing: every project</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  Showing: {p.name}
                </option>
              ))}
            </select>
          )}
          <button className="secondary-button" onClick={() => navigate("/projects")}>
            All Projects
          </button>
        </div>
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
          {/* Status tiles: click one to list those tasks below. */}
          <div className="dash-stats dash-stats-five" role="group" aria-label="Filter tasks by status">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                className={`dash-stat dash-stat-button ${statusFilter === tile.key ? "active" : ""}`}
                aria-pressed={statusFilter === tile.key}
                onClick={() => setStatusFilter(tile.key)}
              >
                <span>
                  {tile.key !== "all" && (
                    <i className="dash-dot" style={{ background: STATUS_COLORS[tile.key] }} aria-hidden="true" />
                  )}
                  {tile.label}
                </span>
                <strong>{tile.value}</strong>
              </button>
            ))}
          </div>

          {/* One health card per project. */}
          <section className="dash-panel">
            <div className="dash-panel-header">
              <h2>Project Health</h2>
              <span className="dash-panel-sub">Click a project to open its board</span>
            </div>

            <div className="dash-projects">
              {shownProjects.map((project) => (
                <ProjectHealthCard
                  key={project._id}
                  project={project}
                  tasks={tasks.filter((t) => sameId(t.project, project._id))}
                  activeSprint={activeSprintOf(project._id)}
                  sprintName={(s) => label(s)}
                  showAi={!isAdmin}
                  risk={(s) => risks[s._id]}
                  riskError={(s) => riskErrors[s._id]}
                  checking={(s) => checkingSprint === s._id}
                  onCheck={checkConfidence}
                  onOpen={() => openBoard(project)}
                />
              ))}
            </div>

            <ul className="dash-legend" aria-label="Colors">
              {(["todo", "in_progress", "review", "done"] as Task["status"][]).map((s) => (
                <li key={s}>
                  <i className="dash-dot" style={{ background: STATUS_COLORS[s] }} aria-hidden="true" />
                  {STATUS_NAMES[s]}
                </li>
              ))}
            </ul>
          </section>

          <section className="dash-panel dash-panel-spaced">
            <div className="dash-panel-header">
              <h2>
                {statusFilter === "all" ? "All tasks" : `${tiles.find((t) => t.key === statusFilter)?.label} tasks`}
              </h2>
              <span className="dash-panel-sub">
                {filteredTotal > filteredTasks.length
                  ? `Showing ${filteredTasks.length} of ${filteredTotal}`
                  : `${filteredTotal} ${filteredTotal === 1 ? "task" : "tasks"}`}
              </span>
              {statusFilter !== "all" && (
                <button type="button" className="dash-link dash-clear" onClick={() => setStatusFilter("all")}>
                  Show all
                </button>
              )}
            </div>
            {filteredTasks.length === 0 ? (
              <p className="dash-muted">No tasks here.</p>
            ) : (
              <ul className="dash-task-table">
                {filteredTasks.map((task) => (
                  <li
                    key={task._id}
                    className="dash-task-link"
                    role="link"
                    tabIndex={0}
                    title="Open this task"
                    onClick={() => openTask(task)}
                    onKeyDown={onActivate(() => openTask(task))}
                  >
                    <span className="dash-status-pill" style={{ borderColor: STATUS_COLORS[task.status] }}>
                      <i className="dash-dot" style={{ background: STATUS_COLORS[task.status] }} aria-hidden="true" />
                      {STATUS_NAMES[task.status]}
                    </span>
                    <strong className={task.status === "done" ? "dash-done" : ""}>{task.title}</strong>
                    <span className="dash-task-meta">
                      {projectOf(task)?.name ?? ""}
                      {task.assignee ? ` · ${task.assignee.name}` : " · Unassigned"}
                    </span>
                    <span className={`dash-badge dash-badge-${task.priority}`}>{priorityLabel(task.priority)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dash-panel dash-panel-spaced">
            <div className="dash-columns">
              <div className="dash-card">
                <h3>Recent Activity</h3>
                {activity.length === 0 ? (
                  <p className="dash-muted">Nothing has happened yet.</p>
                ) : (
                  <ul className="dash-activity">
                    {activity.map((item) => {
                      const open = item.task
                        ? () => openTask(item.task as Task)
                        : item.projectId
                          ? () => navigate(`/projects/${item.projectId}/sprints`)
                          : null;
                      return (
                        <li
                          key={item.key}
                          className={open ? "dash-activity-link" : undefined}
                          role={open ? "link" : undefined}
                          tabIndex={open ? 0 : undefined}
                          onClick={open ?? undefined}
                          onKeyDown={open ? onActivate(open) : undefined}
                        >
                          {item.text} <span>— {timeAgo(item.at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <h3>My Tasks</h3>
                <div className="dash-tabs" role="tablist" aria-label="My tasks">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={myTab === "open"}
                    className={myTab === "open" ? "active" : ""}
                    onClick={() => setMyTab("open")}
                  >
                    To do ({myOpenCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={myTab === "done"}
                    className={myTab === "done" ? "active" : ""}
                    onClick={() => setMyTab("done")}
                  >
                    Finished ({myDoneCount})
                  </button>
                </div>
                {myTasks.length === 0 ? (
                  <p className="dash-muted">
                    {myTab === "open" ? "Nothing open. Tasks assigned to you will appear here." : "Nothing finished yet."}
                  </p>
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
                        onKeyDown={onActivate(() => openTask(task))}
                      >
                        <div>
                          <strong className={task.status === "done" ? "dash-done" : ""}>{task.title}</strong>
                          <span>
                            {taskPlace(task)}
                            {" · "}
                            {task.storyPoints ?? 0} pts
                          </span>
                        </div>
                        {task.status === "done" ? (
                          <span className="dash-badge dash-badge-done">Done</span>
                        ) : (
                          <span className={`dash-badge dash-badge-${task.priority}`}>{priorityLabel(task.priority)}</span>
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

/**
 * One project's health: a bar of its tasks by status, and what matters for
 * its method — the active sprint (Scrum) or the In Progress limit (Kanban).
 */
function ProjectHealthCard({
  project,
  tasks,
  activeSprint,
  sprintName,
  showAi,
  risk,
  riskError,
  checking,
  onCheck,
  onOpen,
}: {
  project: DashProject;
  tasks: Task[];
  activeSprint: Sprint | null;
  sprintName: (s: Sprint) => string;
  showAi: boolean;
  risk: (s: Sprint) => SprintRisk | undefined;
  riskError: (s: Sprint) => string | undefined;
  checking: (s: Sprint) => boolean;
  onCheck: (s: Sprint) => void;
  onOpen: () => void;
}) {
  const kanban = (project.methodology ?? "scrum") === "kanban";
  const by = (status: Task["status"]) => tasks.filter((t) => t.status === status).length;
  const total = tasks.length;
  const done = by("done");
  const percent = total ? Math.round((done / total) * 100) : 0;

  const sprintTasks = activeSprint ? tasks.filter((t) => sameId(t.sprint, activeSprint._id)) : [];
  const sprintDone = sprintTasks.filter((t) => t.status === "done").length;
  const limit = Number(project.wipLimit) || 0;
  const inProgress = by("in_progress");
  const sprintRisk = activeSprint ? risk(activeSprint) : undefined;

  return (
    <div
      className="dash-project"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onActivate(onOpen)}
      title={`Open the ${kanban ? "Kanban" : "Scrum"} board of ${project.name}`}
    >
      <div className="dash-project-head">
        <strong>{project.name}</strong>
        <span className={`dash-method dash-method-${kanban ? "kanban" : "scrum"}`}>{kanban ? "Kanban" : "Scrum"}</span>
      </div>

      <div className="dash-project-progress">
        <span>
          <strong>{percent}%</strong> done
        </span>
        <span>
          {done} of {total} {total === 1 ? "task" : "tasks"}
        </span>
      </div>

      {/* Tasks by status. Each segment names itself on hover. */}
      <div className="dash-bar" aria-label={`${project.name}: ${STATUS_ORDER.map((s) => `${STATUS_NAMES[s]} ${by(s)}`).join(", ")}`}>
        {total === 0 ? (
          <span className="dash-bar-empty" />
        ) : (
          STATUS_ORDER.filter((s) => by(s) > 0).map((s) => (
            <span
              key={s}
              className="dash-bar-seg"
              style={{ width: `${(by(s) / total) * 100}%`, background: STATUS_COLORS[s] }}
              title={`${STATUS_NAMES[s]}: ${by(s)}`}
            />
          ))
        )}
      </div>

      {kanban ? (
        <p className="dash-project-note">
          In Progress{" "}
          <strong className={limit > 0 && inProgress >= limit ? "dash-over" : ""}>
            {limit > 0 ? `${inProgress} / ${limit}` : inProgress}
          </strong>
          {limit > 0 && inProgress >= limit && " · at the limit"} · In Review <strong>{by("review")}</strong>
        </p>
      ) : activeSprint ? (
        <>
          <p className="dash-project-note">
            {sprintName(activeSprint)} · <strong>{daysLeft(activeSprint.endDate)}</strong> days left ·{" "}
            <strong>
              {sprintDone}/{sprintTasks.length}
            </strong>{" "}
            done
          </p>
          {showAi && (
            // The AI button must not also open the board.
            <div className="dash-project-ai" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {sprintRisk ? (
                <p className="dash-ai-line" title={sprintRisk.reasoning}>
                  <strong className={`dash-risk-small dash-risk-${sprintRisk.risk}`}>
                    {sprintRisk.completionForecastPercent}% expected
                  </strong>
                  <span className="dash-ai-text">{firstSentence(sprintRisk.reasoning)}</span>
                </p>
              ) : (
                <button
                  type="button"
                  className="dash-link"
                  onClick={() => onCheck(activeSprint)}
                  disabled={checking(activeSprint)}
                >
                  {checking(activeSprint) ? "Checking…" : "AI: will this sprint finish?"}
                </button>
              )}
              {riskError(activeSprint) && (
                <p className="dash-error" role="alert">
                  {riskError(activeSprint)}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="dash-project-note">No active sprint</p>
      )}
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
    items.push({ key: `t-${task._id}`, text, at: task.updatedAt, task });
  }

  for (const sprint of sprints) {
    const name = sprintLabel(sprint, sprints.filter((s) => sameId(s.project, sprint.project)));
    const projectId = String(sprint.project);
    if (sprint.completedAt) {
      items.push({ key: `sc-${sprint._id}`, text: `${name} completed`, at: sprint.completedAt, projectId });
    }
    if (sprint.startedAt) {
      items.push({ key: `ss-${sprint._id}`, text: `${name} started`, at: sprint.startedAt, projectId });
    }
    if (sprint.createdAt) {
      items.push({ key: `sp-${sprint._id}`, text: `${name} planned`, at: sprint.createdAt, projectId });
    }
  }

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
}
