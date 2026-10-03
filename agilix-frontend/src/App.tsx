import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/auth-context";
import AppShell from "./components/layout/AppShell";
import ProjectDashboard from "./components/dashboard/ProjectDashboard";
import ProductBacklogPage from "./components/scrum/ProductBacklogPage";
import ScrumBoardPage from "./components/scrum/ScrumBoardPage";
import NewTaskPage from "./components/scrum/NewTaskPage";
import ProjectTeamPage from "./components/team/ProjectTeamPage";
import ReportsPage from "./components/reports/ReportsPage";
import ProjectCard from "./components/projects/ProjectCard";
import ProjectSettings from "./components/projects/ProjectSettings";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "./api/projects";
import "./components/team/team.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

type User = {
  _id: string;
  name: string;
  email: string;
  role: string;
};

type Project = {
  _id: string;
  name: string;
  description?: string;
  owner?: User;
  members?: User[];
  methodology?: "scrum" | "kanban";
  status?: ProjectStatus;
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high";
  project: string;
  sprint?: string | null;
  assignee?: User | null;
  storyPoints?: number;
  type?: string | null;
};

type Sprint = {
  _id: string;
  name: string;
  project: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: string;
};

type SprintRisk = {
  risk: "green" | "yellow" | "red";
  reasoning: string;
  completionForecastPercent: number;
};

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// How long the user can be idle before we auto-pause a running timer.
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

// Browser events that count as "the user is active". We only ever check
// THAT one of these fired, never read anything about the event itself
// (no keys pressed, no cursor position, nothing is stored or sent anywhere).
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

function TaskTimer({ task }: { task: Task }) {
  const { user: currentUser } = useAuth();
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pausedByInactivity, setPausedByInactivity] = useState(false);

  // A ref (not state) so updating it on every mouse move doesn't re-render.
  const lastActivityRef = useRef(Date.now());

  // Tracks which load() call is the most recent one, so that if two
  // load() calls overlap (e.g. the page-load fetch and the fetch right
  // after Pause), a slower/older response can never overwrite a newer,
  // more correct one that already arrived.
  const loadIdRef = useRef(0);

  const load = async () => {
    const requestId = ++loadIdRef.current;

    try {
      const [activeRes, totalRes] = await Promise.all([
        // The server returns the logged-in user's own running timer on this task.
        fetch(`${API_URL}/time-entries/task/${task._id}/active`),
        fetch(`${API_URL}/time-entries/task/${task._id}/total`),
      ]);

      // A newer load() started while this one was still in flight —
      // its result is stale, so don't let it touch the UI.
      if (requestId !== loadIdRef.current) return;

      if (activeRes.ok) {
        const activeText = await activeRes.text();
        const active = activeText ? JSON.parse(activeText) : null;
        if (active) {
          setActiveEntryId(active._id);
          setElapsed(
            Math.floor(
              (Date.now() - new Date(active.startTime).getTime()) / 1000
            )
          );
        } else {
          setActiveEntryId(null);
        }
      }

      if (totalRes.ok) {
        const totalText = await totalRes.text();
        const total = totalText ? JSON.parse(totalText) : { totalSeconds: 0 };
        setTotalSeconds(total.totalSeconds);
      }
    } finally {
      if (requestId === loadIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task._id]);

  // Ticks the visible "elapsed" clock once a second while a timer is running.
  useEffect(() => {
    if (!activeEntryId) return;

    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [activeEntryId]);

  // Inactivity watcher: only active while THIS task's timer is running.
  // Reuses the same "stop" endpoint as a manual pause — we just remember
  // afterwards that it was the inactivity watcher that closed it, so the
  // UI can show the warning + Resume button instead of a plain Start button.
  useEffect(() => {
    if (!activeEntryId) return;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActive)
    );
    lastActivityRef.current = Date.now();

    const checkInterval = setInterval(async () => {
      const idleFor = Date.now() - lastActivityRef.current;

      if (idleFor >= INACTIVITY_LIMIT_MS) {
        const response = await fetch(
          `${API_URL}/time-entries/${activeEntryId}/stop`,
          { method: "PATCH" }
        );

        if (response.ok) {
          setActiveEntryId(null);
          setPausedByInactivity(true);
          await load();
        }
      }
    }, 10000); // check every 10s — cheap, and 10s of slack on a 15-minute limit is fine

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, markActive)
      );
      clearInterval(checkInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntryId]);

  const start = async () => {
    // The time is saved for whoever is logged in; the server decides that, not this page.
    const response = await fetch(`${API_URL}/time-entries/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: task._id }),
    });

    if (response.ok) {
      const entry = await response.json();
      setActiveEntryId(entry._id);
      setElapsed(0);
      setPausedByInactivity(false);
    } else {
      const err = await response.json();
      alert(err.message || "Failed to start timer");
    }
  };

  // Manual "Pause" button — same stop endpoint the inactivity watcher uses.
  const pause = async () => {
    if (!activeEntryId) return;

    const response = await fetch(
      `${API_URL}/time-entries/${activeEntryId}/stop`,
      { method: "PATCH" }
    );

    if (response.ok) {
      setActiveEntryId(null);
      setPausedByInactivity(false);
      await load();
    }
  };

  // Resume after an inactivity pause is just a normal start — it opens a
  // new time segment. The idle period itself was never saved, since we
  // stopped the timer the moment inactivity was detected.
  const resume = async () => {
    setPausedByInactivity(false);
    await start();
  };

  if (loading) return null;

  // Only the person a task is assigned to can time it (the server enforces this too).
  const isMine = !!task.assignee && task.assignee._id === currentUser._id;
  if (!task.assignee) {
    return <span className="timer-hint">Assign someone to track time</span>;
  }

  // A finished task needs no timer, and nobody else can time it: only the time spent is shown.
  if (task.status === "done" || !isMine) {
    return (
      <div className="task-timer">
        <span className="timer-total">Total: {formatDuration(totalSeconds)}</span>
      </div>
    );
  }

  if (pausedByInactivity) {
    return (
      <div className="task-timer">
        <span className="timer-total">
          Total: {formatDuration(totalSeconds)}
        </span>

        <div className="timer-inactivity-warning">
          <span>Timer paused due to inactivity</span>
          <button className="timer-button" onClick={resume}>
            ▶ Resume Timer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-timer">
      <span className="timer-total">Total: {formatDuration(totalSeconds)}</span>

      {activeEntryId ? (
        <button className="timer-button timer-running" onClick={pause}>
          ⏱ {formatDuration(elapsed)} ⏸ Pause
        </button>
      ) : (
        <button className="timer-button" onClick={start}>
          ▶ Start Timer
        </button>
      )}
    </div>
  );
}

/**
 * The reason a request failed, in the server's own words when it gave one
 * (for example "You do not have access to this project..."), otherwise the fallback.
 */
async function failureMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // The body was not JSON; use the fallback below.
  }
  return fallback;
}

function ProjectsPage() {
  const { user: currentUser } = useAuth();
  // Admins and managers create projects (the backend enforces this too).
  const canCreateProjects = currentUser.role === "admin" || currentUser.role === "manager";
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [methodology, setMethodology] = useState<"scrum" | "kanban">("scrum");

  // Team chosen by the person creating the project: people are found by email and shown as chips.
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [memberChoice, setMemberChoice] = useState("");

  const navigate = useNavigate();

  const loadProjects = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/projects`);

      if (!response.ok) {
        throw new Error(
          await failureMessage(
            response,
            "We could not load your projects. Please check your connection and try again.",
          ),
        );
      }

      const data = await response.json();
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    if (canCreateProjects) {
      fetch(`${API_URL}/users`)
        .then((res) => (res.ok ? res.json() : []))
        .then(setAllUsers)
        .catch(() => setAllUsers([]));
    }
  }, [canCreateProjects]);

  // People who can still be added: not the owner (you) and not already chosen.
  const addableUsers = allUsers.filter(
    (u) => u._id !== currentUser._id && !members.some((m) => m._id === u._id)
  );

  const addMember = () => {
    const chosen = addableUsers.find((u) => u._id === memberChoice);
    if (!chosen) return;
    setMembers([...members, chosen]);
    setMemberChoice("");
  };

  const createProject = async () => {
    if (!name.trim()) {
      alert("Please enter a project name.");
      return;
    }

    try {
      setCreating(true);

      const response = await fetch(`${API_URL}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
          methodology,
          members: members.map((m) => m._id),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create project");
      }

      setName("");
      setDescription("");
      setMethodology("scrum");
      setMembers([]);
      setMemberChoice("");
      setShowForm(false);

      await loadProjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </p>
          <h1>Projects</h1>
          <p className="page-description">
            Manage your Agile projects and teams.
          </p>
        </div>

        {canCreateProjects && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            + New Project
          </button>
        )}
      </div>

      {canCreateProjects && showForm && (
        <div className="form-card">
          <h2>Create New Project</h2>

          <label>Project name</label>
          <input
            type="text"
            placeholder="Enter project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Description</label>
          <textarea
            placeholder="Enter project description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <label>Team members</label>
          <div className="member-invite">
            <select
              value={memberChoice}
              onChange={(e) => setMemberChoice(e.target.value)}
            >
              <option value="">Select a person</option>
              {addableUsers.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-button"
              onClick={addMember}
              disabled={!memberChoice}
            >
              Add
            </button>
          </div>
          {members.length > 0 && (
            <div className="member-chips">
              {members.map((m) => (
                <span className="member-chip" key={m._id}>
                  {m.name}
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={() =>
                      setMembers(members.filter((x) => x._id !== m._id))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <label>Methodology</label>
          <div className="methodology-toggle">
            <button
              type="button"
              className={`methodology-option ${
                methodology === "scrum" ? "active" : ""
              }`}
              onClick={() => setMethodology("scrum")}
            >
              <strong>Scrum</strong>
              <span>Sprints + backlog</span>
            </button>

            <button
              type="button"
              className={`methodology-option ${
                methodology === "kanban" ? "active" : ""
              }`}
              onClick={() => setMethodology("kanban")}
            >
              <strong>Kanban</strong>
              <span>Continuous workflow</span>
            </button>
          </div>

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>

            <button
              className="primary-button"
              onClick={createProject}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <h2>Loading projects...</h2>
          <p>Connecting to your AgiliX backend.</p>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load projects</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="empty-state">
          <h2>No projects yet</h2>
          <p>
            {canCreateProjects
              ? "Create your first AgiliX project to get started."
              : "You are not on any project yet. Ask an admin or a manager to add you to one."}
          </p>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project._id}
              project={project}
              onOpen={() =>
                navigate(
                  (project.methodology || "scrum") === "kanban"
                    ? `/projects/${project._id}/kanban`
                    : `/projects/${project._id}/sprints`,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPage() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const isAdmin = currentUser.role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/users`);

      if (!response.ok) {
        throw new Error("Failed to load team members");
      }

      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const changeRole = async (target: User, role: string) => {
    try {
      const response = await fetch(`${API_URL}/users/${target._id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          Array.isArray(data.message) ? data.message.join(", ") : data.message
        );
      }
      setUsers((list) =>
        list.map((u) => (u._id === target._id ? { ...u, role } : u))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to change the role");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </p>
          <h1>Team</h1>
          <p className="page-description">
            Manage members of your AgiliX workspace.
          </p>
        </div>

      </div>

      {loading && (
        <div className="empty-state">
          <h2>Loading team...</h2>
          <p>Fetching users from your AgiliX backend.</p>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load team</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="empty-state">
          <h2>No team members</h2>
          <p>Add your first member to the workspace.</p>
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="team-grid">
          {users.map((user) => (
            <div className="team-card" key={user._id}>
              <div className="team-avatar">
                {user.name.charAt(0).toUpperCase()}
              </div>

              <div>
                <h2>{user.name}</h2>
                <p>{user.email}</p>
                <span className="role-badge">{user.role}</span>
                {isAdmin && user._id !== currentUser._id && (
                  <div>
                    <select
                      className="role-select"
                      aria-label={`Role of ${user.name}`}
                      value={user.role}
                      onChange={(e) => changeRole(user, e.target.value)}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="developer">Developer</option>
                      <option value="tester">Tester</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectOverviewPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProject = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/projects/${projectId}`);

      if (!response.ok) {
        throw new Error(
          await failureMessage(
            response,
            "We could not load this project. Please try again.",
          ),
        );
      }

      setProject(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProject();
  }, [projectId]);

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading project...</h2>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="empty-state">
        <h2>Unable to load project</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate("/projects")}
          >
            ← All Projects
          </p>
          <h1>{project.name}</h1>
          <p className="page-description">
            {project.description ||
              "AI-powered Agile Project Management Platform"}
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => navigate(`/projects/${projectId}/backlog`)}
        >
          + Create Task
        </button>
      </div>

      <ProjectSettings
        project={project}
        onSaved={setProject}
        onDeleted={() => navigate("/projects")}
      />

      <div className="project-info-card">
        <div>
          <span className="eyebrow">OWNER</span>
          <h3>{project.owner?.name || "Unassigned"}</h3>
          <p>{project.owner?.email || "-"}</p>
        </div>

        <div>
          <span className="eyebrow">TEAM MEMBERS</span>
          <h3>{project.members?.length || 0}</h3>
          <p>members</p>
        </div>

        <div>
          <span className="eyebrow">PROJECT STATUS</span>
          <h3>{PROJECT_STATUS_LABELS[project.status ?? "active"]}</h3>
          <p>
            {(project.status ?? "active") === "on_hold"
              ? "Work is paused"
              : (project.status ?? "active") === "completed"
                ? "Work is finished"
                : "Currently in development"}
          </p>
        </div>

        <div>
          <span className="eyebrow">METHODOLOGY</span>
          <h3>
            {(project.methodology || "scrum") === "kanban"
              ? "Kanban"
              : "Scrum"}
          </h3>
          <p>
            {(project.methodology || "scrum") === "kanban"
              ? "Continuous workflow"
              : "Sprints + backlog"}
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">BACKLOG</span>
              <h2>Tasks</h2>
            </div>
          </div>

          <p>
            Manage your product backlog, create tasks and prioritize
            upcoming work.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/backlog`)}
          >
            View Backlog
          </button>
        </div>

        {(project.methodology || "scrum") === "kanban" ? (
          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">KANBAN</span>
                <h2>Board</h2>
              </div>
            </div>

            <p>
              Move tasks across Todo, In Progress and Done in a continuous
              workflow — no sprints.
            </p>

            <button
              className="secondary-button"
              onClick={() => navigate(`/projects/${projectId}/kanban`)}
            >
              View Board
            </button>
          </div>
        ) : (
          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">SPRINT</span>
                <h2>Active Sprint</h2>
              </div>
            </div>

            <p>
              Plan your sprint, assign tasks and track progress toward your
              sprint goal.
            </p>

            <button
              className="secondary-button"
              onClick={() => navigate(`/projects/${projectId}/sprints`)}
            >
              View Sprint
            </button>
          </div>
        )}

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">TEAM</span>
              <h2>Members</h2>
            </div>
          </div>

          <p>
            View project members and manage task assignments across your
            Agile team.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/team`)}
          >
            Manage Team
          </button>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">REPORTS</span>
              <h2>Progress</h2>
            </div>
          </div>

          <p>
            Track sprint velocity, completion progress and project
            performance. Sprint risk predictions are under AI Insights.
          </p>

          <div className="dashboard-card-actions">
            {currentUser.role !== "admin" && (
              <button
                className="secondary-button"
                onClick={() => navigate(`/projects/${projectId}/reports`)}
              >
                View Reports
              </button>
            )}

            {(project.methodology || "scrum") === "scrum" && (
              <button
                className="secondary-button"
                onClick={() => navigate(`/projects/${projectId}/ai-insights`)}
              >
                AI Insights
              </button>
            )}
          </div>
        </div>

      </div>

      <div className="project-workspace-card">
        <span className="eyebrow">PROJECT WORKSPACE</span>

        <h2>Build your Agile workflow</h2>

        <p>
          AgiliX brings your backlog, sprints, tasks, team, reports and AI
          insights together in one workspace.
        </p>

        <div className="workflow-steps">
          <span>Backlog</span>
          <span>→</span>
          <span>Sprint</span>
          <span>→</span>
          <span>In Progress</span>
          <span>→</span>
          <span>Review</span>
          <span>→</span>
          <span>Done</span>
        </div>
      </div>
    </div>
  );
}

// Product Backlog (Scrum) — see components/scrum/ProductBacklogPage.tsx.
// The time tracker stays here and is shown inside each opened backlog task.
function BacklogPage() {
  return <ProductBacklogPage renderTaskTools={(task) => <TaskTimer task={task} />} />;
}

// Scrum Board — see components/scrum/ScrumBoardPage.tsx.
// The time tracker stays here and is shown on each sprint card.
function SprintPage() {
  return <ScrumBoardPage renderTaskTools={(task) => <TaskTimer task={task} />} />;
}

function AiInsightsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [risk, setRisk] = useState<SprintRisk | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!projectId) return;

      try {
        setLoading(true);

        const response = await fetch(
          `${API_URL}/sprints?project=${projectId}`
        );

        if (!response.ok) {
          throw new Error(
            await failureMessage(response, "We could not load the sprints. Please try again."),
          );
        }

        const data: Sprint[] = await response.json();

        // The risk check is for the sprint that is running now, so only active
        // sprints are offered. With none, the page says there is no active sprint.
        const active = data.filter((s) => s.status === "active");
        setSprints(active);

        if (active.length > 0) {
          setSelectedSprintId(active[0]._id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [projectId]);

  const checkRisk = async () => {
    if (!selectedSprintId) return;

    try {
      setChecking(true);
      setError("");

      const response = await fetch(
        `${API_URL}/ai/sprint-risk/${selectedSprintId}`
      );

      if (!response.ok) {
        // Show the reason the server gives (for example "AI service is busy"), not a generic line.
        let reason = "";
        try {
          const body = await response.json();
          reason = Array.isArray(body.message) ? body.message.join(", ") : body.message ?? "";
        } catch {
          reason = "";
        }
        throw new Error(reason || "Failed to get AI risk prediction");
      }

      setRisk(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Back to project
          </p>
          <h1>AI Sprint Risk</h1>
          <p className="page-description">
            Use AI to predict whether your team can complete the sprint.
          </p>
        </div>
      </div>

      {loading && (
        <div className="empty-state">
          <h2>Loading sprints...</h2>
        </div>
      )}

      {!loading && sprints.length === 0 && (
        <div className="empty-state">
          <h2>No active sprint</h2>
          <p>Start a sprint to run an AI risk check.</p>
        </div>
      )}

      {!loading && sprints.length > 0 && (
        <div className="form-card">
          <label>Sprint</label>
          <select
            value={selectedSprintId}
            onChange={(e) => {
              setSelectedSprintId(e.target.value);
              setRisk(null);
            }}
          >
            {sprints.map((sprint) => (
              <option key={sprint._id} value={sprint._id}>
                {sprint.name}
              </option>
            ))}
          </select>

          <div className="form-actions">
            <button
              className="primary-button"
              onClick={checkRisk}
              disabled={checking}
            >
              {checking ? "Checking..." : "Run AI Risk Check"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Something went wrong</h2>
          <p>{error}</p>
        </div>
      )}

      {risk && (
        <div className={`risk-card risk-${risk.risk}`}>
          <span className="eyebrow">RISK LEVEL</span>
          <h2>{risk.risk.toUpperCase()}</h2>
          <p>{risk.reasoning}</p>
          <div className="risk-forecast">
            Forecast completion: {risk.completionForecastPercent}%
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanBoardPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");

  const load = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError("");

      const [taskRes, userRes] = await Promise.all([
        fetch(`${API_URL}/tasks?project=${projectId}`),
        fetch(`${API_URL}/users`),
      ]);

      if (!taskRes.ok) {
        throw new Error(
          await failureMessage(taskRes, "We could not load the board. Please try again."),
        );
      }

      setTasks(await taskRes.json());

      if (userRes.ok) {
        setUsers(await userRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const createTask = async () => {
    if (!title.trim()) {
      alert("Please enter a task title.");
      return;
    }

    try {
      setCreating(true);

      const response = await fetch(`${API_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          project: projectId,
          priority,
          assignee: assignee || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create task");
      }

      setTitle("");
      setDescription("");
      setPriority("medium");
      setAssignee("");
      setShowForm(false);

      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const moveTask = async (taskId: string, status: Task["status"]) => {
    // Optimistic update so the card jumps columns instantly, then
    // reconcile with the server. Reload on failure to undo it.
    setTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, status } : t))
    );

    const response = await fetch(`${API_URL}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      alert("Failed to move task");
      await load();
    }
  };

  const columns: { key: Task["status"]; label: string }[] = [
    { key: "todo", label: "Todo" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Back to project
          </p>
          <h1>Kanban Board</h1>
          <p className="page-description">
            Continuous workflow — move tasks across columns as work
            progresses.
          </p>
        </div>

        <div className="scrum-header-actions">
          {currentUser.role !== "admin" && (
            <button
              className="secondary-button"
              onClick={() => navigate(`/projects/${projectId}/reports`)}
            >
              Reports
            </button>
          )}
          <button className="primary-button" onClick={() => setShowForm(true)}>
            + Create Task
          </button>
        </div>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>Create Task</h2>

          <label>Title</label>
          <input
            type="text"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label>Description</label>
          <textarea
            placeholder="Task description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <label>Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <label>Assignee</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user._id} value={user._id}>
                {user.name}
              </option>
            ))}
          </select>

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>

            <button
              className="primary-button"
              onClick={createTask}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Task"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <h2>Loading board...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load board</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="kanban-board">
          {columns.map((column) => {
            const columnTasks = tasks.filter((t) => t.status === column.key);

            return (
              <div className="kanban-column" key={column.key}>
                <div className="kanban-column-header">
                  <span>{column.label}</span>
                  <span className="kanban-column-count">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="kanban-column-body">
                  {columnTasks.length === 0 && (
                    <p className="kanban-empty">No tasks here</p>
                  )}

                  {columnTasks.map((task) => (
                    <div className="kanban-card" key={task._id}>
                      <h3>{task.title}</h3>
                      <p>{task.description || "No description"}</p>

                      <div className="task-card-meta">
                        <span
                          className={`priority-badge priority-${task.priority}`}
                        >
                          {task.priority}
                        </span>
                        {task.assignee && (
                          <span className="role-badge">
                            {task.assignee.name}
                          </span>
                        )}
                      </div>

                      <TaskTimer task={task} />

                      <select
                        className="kanban-move-select"
                        value={task.status}
                        onChange={(e) =>
                          moveTask(task._id, e.target.value as Task["status"])
                        }
                      >
                        <option value="todo">Move to Todo</option>
                        <option value="in_progress">Move to In Progress</option>
                        <option value="done">Move to Done</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// First page after login (Figma "Dashboard"): totals across all my projects.
function DashboardPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const canCreateProjects = currentUser.role === "admin" || currentUser.role === "manager";
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/projects`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await failureMessage(
              response,
              "We could not load your projects. Please check your connection and try again.",
            ),
          );
        }
        return response.json() as Promise<Project[]>;
      })
      .then(setProjects)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load projects"),
      );
  }, []);

  if (error) {
    return (
      <div className="empty-state">
        <h2>Unable to load dashboard</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!projects) {
    return (
      <div className="empty-state">
        <h2>Loading dashboard...</h2>
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <h2>No projects yet</h2>
        <p>
          {canCreateProjects
            ? "Create your first project to see your dashboard."
            : "You are not on any project yet. Ask an admin or a manager to add you to one."}
        </p>
        {canCreateProjects && (
          <button className="primary-button" onClick={() => navigate("/projects")}>
            Go to Projects
          </button>
        )}
      </div>
    );
  }
  return <ProjectDashboard projects={projects} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/projects" element={<ProjectsPage />} />

          <Route
            path="/projects/:projectId"
            element={<ProjectOverviewPage />}
          />

          <Route
            path="/projects/:projectId/backlog"
            element={<BacklogPage />}
          />

          <Route
            path="/projects/:projectId/sprints"
            element={<SprintPage />}
          />

          <Route
            path="/projects/:projectId/tasks/new"
            element={<NewTaskPage />}
          />

          <Route
            path="/projects/:projectId/kanban"
            element={<KanbanBoardPage />}
          />

          <Route
            path="/projects/:projectId/ai-insights"
            element={<AiInsightsPage />}
          />

          <Route
            path="/projects/:projectId/reports"
            element={<ReportsPage />}
          />

          <Route
            path="/projects/:projectId/team"
            element={<ProjectTeamPage />}
          />
          <Route path="/team" element={<TeamPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;