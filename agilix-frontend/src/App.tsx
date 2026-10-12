import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useEffect, useRef, useState, type ReactElement } from "react";
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
import ApprovalsPage from "./components/approvals/ApprovalsPage";
import TeamRequests from "./components/team/TeamRequests";
import AdminTeamPage from "./components/team/AdminTeamPage";
import KanbanDndBoard from "./components/kanban/KanbanDndBoard";
import { personLabel, useProjectPeople } from "./components/team/useProjectPeople";
import { canEditTaskPlan, canMarkDone, readError } from "./components/scrum/taskDisplay";
import StoryPointEstimator from "./components/ai/StoryPointEstimator";
import PriorityRecommender from "./components/ai/PriorityRecommender";
import KanbanInsights from "./components/ai/KanbanInsights";
import TaskSuggestions from "./components/ai/TaskSuggestions";
import { STORY_POINT_SCALE, type StoryPointValue, type TaskSuggestion } from "./api/ai";
import { getSprints, type Sprint as ApiSprint } from "./api/sprints";
import { daysLeft, formatLongDate, sprintLabel } from "./components/scrum/taskDisplay";
import { PROJECT_STATUS_LABELS, getProject, updateProject, type ProjectStatus } from "./api/projects";
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
  /** What a tester asked to fix when sending the task back from Review. */
  reviewNote?: { text: string; byName?: string } | null;
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
const INACTIVITY_LIMIT_MS = 60 * 1000; // 1 minute

// Browser events that count as "the user is active". We only ever check
// THAT one of these fired, never read anything about the event itself
// (no keys pressed, no cursor position, nothing is stored or sent anywhere).
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

// Sent on window when starting one timer paused the person's other running timer(s).
const TIMERS_PAUSED_EVENT = "agilix:timers-paused";

function TaskTimer({ task }: { task: Task }) {
  const { user: currentUser } = useAuth();
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pausedByInactivity, setPausedByInactivity] = useState(false);
  // A tester's review timer is their own: it counts only their time, not the developer's.
  const reviewTimer = currentUser.role === "tester" && task.status === "review";

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
        fetch(`${API_URL}/time-entries/task/${task._id}/total${reviewTimer ? "?mine=1" : ""}`),
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
  }, [task._id, reviewTimer]);

  // Starting a timer on another task pauses this one (only one runs at a time).
  // The page that started it announces which tasks were paused.
  useEffect(() => {
    const onPaused = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail ?? [];
      if (ids.includes(task._id)) {
        setActiveEntryId(null);
        setPausedByInactivity(false);
        load();
      }
    };
    window.addEventListener(TIMERS_PAUSED_EVENT, onPaused);
    return () => window.removeEventListener(TIMERS_PAUSED_EVENT, onPaused);
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
        // The timer is stopped at the moment of the last activity, so the idle
        // minute is not counted as working time.
        const response = await fetch(
          `${API_URL}/time-entries/${activeEntryId}/stop`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              endedAt: new Date(lastActivityRef.current).toISOString(),
            }),
          }
        );

        if (response.ok) {
          setActiveEntryId(null);
          setPausedByInactivity(true);
          await load();
        } else {
          // Already stopped on the server (for example paused by another task).
          await load();
        }
      }
    }, 5000); // check every 5s: cheap, and 5s of slack on a 1-minute limit is fine

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

      const pausedTasks: { taskId: string; title: string }[] = entry.pausedTasks ?? [];
      if (pausedTasks.length > 0) {
        window.dispatchEvent(
          new CustomEvent(TIMERS_PAUSED_EVENT, { detail: pausedTasks.map((t) => t.taskId) })
        );
        alert(
          `Only one timer can run at a time, so the timer on “${pausedTasks
            .map((t) => t.title)
            .join("”, “")}” was paused.`
        );
      }
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

    // Even if the server says it was already stopped (for example it was paused
    // by starting another task), refresh so the button shows the real state.
    if (response.ok) {
      setActiveEntryId(null);
      setPausedByInactivity(false);
    }
    await load();
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
  // A tester can also time their review of a task that is in Review.
  const testerReview = reviewTimer;
  const isMine = (!!task.assignee && task.assignee._id === currentUser._id) || testerReview;
  if (!task.assignee && !testerReview) {
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
          <span>Timer paused after 1 minute of inactivity</span>
          <button className="timer-button" onClick={resume}>
            ▶ Resume Timer
          </button>
        </div>
      </div>
    );
  }

  // One clock that never goes back to zero: the time already saved plus the
  // stretch that is running now. Pausing and resuming just continues from it.
  const clock = totalSeconds + (activeEntryId ? elapsed : 0);

  return (
    <div className="task-timer">
      {reviewTimer && <span className="timer-hint">Your review time</span>}
      {activeEntryId ? (
        <button className="timer-button timer-running" onClick={pause}>
          ⏱ {formatDuration(clock)} ⏸ Pause
        </button>
      ) : (
        <>
          <span className="timer-total">Total: {formatDuration(totalSeconds)}</span>
          <button className="timer-button" onClick={start}>
            {totalSeconds > 0 ? "▶ Resume Timer" : "▶ Start Timer"}
          </button>
        </>
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
  // Only managers create projects (the backend enforces this too). Admins view them.
  const canCreateProjects = currentUser.role === "manager";
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

  // An admin adds a manager; a manager asks developers and testers to join (they
  // join once they accept). Admins are never listed, and nobody is listed twice.
  const addableUsers = allUsers.filter(
    (u) =>
      u._id !== currentUser._id &&
      !members.some((m) => m._id === u._id) &&
      (u.role === "developer" || u.role === "tester")
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
          {currentUser.role !== "admin" && (
            <p
              className="eyebrow breadcrumb-link"
              onClick={() => navigate("/dashboard")}
            >
              ← Dashboard
            </p>
          )}
          <h1>Projects</h1>
          <p className="page-description">
            {currentUser.role === "admin"
              ? "Open a project to see its managers, their teams and reports."
              : "Manage your Agile projects and teams."}
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

          <label>{currentUser.role === "admin" ? "Manager" : "Team members"}</label>
          <div className="member-invite">
            <select
              value={memberChoice}
              onChange={(e) => setMemberChoice(e.target.value)}
            >
              <option value="">
                {currentUser.role === "admin" ? "Select a manager" : "Select a developer or tester"}
              </option>
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
          {currentUser.role === "manager" && (
            <p className="member-hint">
              Each person gets a team request and joins once they accept.
            </p>
          )}
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
              // The project's details page (active sprint, backlog, team...).
              // The board is opened from there.
              onOpen={() => navigate(`/projects/${project._id}`)}
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

      if (!isAdmin) {
        // Everyone else sees only the people who share a project with them.
        const projectResponse = await fetch(`${API_URL}/projects`);
        if (!projectResponse.ok) throw new Error("Failed to load team members");
        const mine = (await projectResponse.json()) as Project[];
        const people: User[] = [];
        for (const project of mine) {
          for (const person of [project.owner, ...(project.members ?? [])]) {
            if (
              person &&
              person._id &&
              person.role !== "admin" &&
              !people.some((p) => p._id === person._id)
            ) {
              people.push(person);
            }
          }
        }
        if (!people.some((p) => p._id === currentUser._id)) people.unshift(currentUser);
        setUsers(people);
        return;
      }

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
            onClick={() => navigate(isAdmin ? "/projects" : "/dashboard")}
          >
            {isAdmin ? "← All Projects" : "← Dashboard"}
          </p>
          <h1>Team</h1>
          <p className="page-description">
            {isAdmin
              ? "Manage members of your AgiliX workspace."
              : "People you work with on your projects."}
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
          <p>{isAdmin ? "Add your first member to the workspace." : "People on your projects will appear here."}</p>
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
                <h2>{user._id === currentUser._id ? `${user.name} (Myself)` : user.name}</h2>
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

function ProjectOverviewBody() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  // The project's sprints, to show the active one on this page.
  const [projectSprints, setProjectSprints] = useState<ApiSprint[]>([]);
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
      // Optional: if the sprints cannot be loaded the page still works.
      setProjectSprints(await getSprints(projectId).catch(() => []));
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
          onClick={() =>
            navigate(
              (project.methodology || "scrum") === "kanban"
                ? `/projects/${projectId}/kanban?create=1`
                : `/projects/${projectId}/backlog`,
            )
          }
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

      <div className="dashboard-grid dashboard-grid-fill">
        {/* The backlog belongs to Scrum (tasks waiting for a sprint). Kanban
            projects keep all their tasks on the board. */}
        {(project.methodology || "scrum") !== "kanban" && (
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
        )}

        {(project.methodology || "scrum") === "kanban" ? (
          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">KANBAN</span>
                <h2>Board</h2>
              </div>
            </div>

            <p>
              Move tasks across To Do, In Progress, Review and Done in a
              continuous workflow — no sprints.
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

            {(() => {
              const active = projectSprints.find((sp) => sp.status === "active");
              return active ? (
                <p>
                  <strong>{sprintLabel(active, projectSprints)}</strong>
                  <br />
                  {formatLongDate(active.startDate.slice(0, 10))} –{" "}
                  {formatLongDate(active.endDate.slice(0, 10))} ·{" "}
                  {daysLeft(active.endDate)} {daysLeft(active.endDate) === 1 ? "day" : "days"} left
                  {active.goal ? (
                    <>
                      <br />
                      Goal: {active.goal}
                    </>
                  ) : null}
                </p>
              ) : (
                <p>
                  There is no active sprint right now. Plan one on the Scrum
                  Board and start it when the team is ready.
                </p>
              );
            })()}

            <button
              className="secondary-button"
              onClick={() => navigate(`/projects/${projectId}/sprints`)}
            >
              {projectSprints.some((sp) => sp.status === "active")
                ? "Open Active Sprint"
                : "View Sprints"}
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
              <span className="eyebrow">APPROVALS</span>
              <h2>Requests</h2>
            </div>
          </div>

          <p>
            {currentUser.role === "manager" || currentUser.role === "admin"
              ? "Approve or reject requests from developers and testers to create or delete tasks."
              : "Creating or deleting a task needs a manager's approval. See your requests here."}
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/approvals`)}
          >
            View Requests
          </button>
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

/**
 * Pages that belong to Scrum only (backlog, sprints, the sprint task form).
 * A Kanban project has none of these, so it is sent to its Kanban board
 * instead, e.g. when someone follows an old link.
 */
function ScrumOnly({ children, createTask = false }: { children: ReactElement; createTask?: boolean }) {
  const { projectId } = useParams();
  const [methodology, setMethodology] = useState<"scrum" | "kanban" | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getProject(projectId)
      .then((project) => !cancelled && setMethodology(project.methodology ?? "scrum"))
      // If the project can't be loaded, let the page show its own error.
      .catch(() => !cancelled && setMethodology("scrum"));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (methodology === null) return null;
  if (methodology === "kanban") {
    return <Navigate to={`/projects/${projectId}/kanban${createTask ? "?create=1" : ""}`} replace />;
  }
  return children;
}

// Product Backlog (Scrum) — see components/scrum/ProductBacklogPage.tsx.
// Work in the backlog has not started, so an opened task has no timer.
function BacklogPage() {
  return <ProductBacklogPage />;
}

// Scrum Board — see components/scrum/ScrumBoardPage.tsx.
// The time tracker stays here and is shown on each sprint card.
function SprintPage() {
  // Work in To Do has not started, so it has no timer.
  return (
    <ScrumBoardPage
      renderTaskTools={(task) => (task.status === "todo" ? null : <TaskTimer task={task} />)}
    />
  );
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

const STATUS_NAMES: Record<Task["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

function KanbanBoardPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  // Managers and admins assign tasks to anyone on the team and can change the
  // assignee later. Developers and testers create tasks for themselves (or
  // unassigned), as on the Scrum side; the backend enforces the same rule.
  const canAssignOthers = canEditTaskPlan(currentUser.role);
  const people = useProjectPeople(canAssignOthers ? projectId : undefined);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "+ Create Task" on the project page links here with ?create=1.
  const [searchParams, setSearchParams] = useSearchParams();
  // "Add a task" panel, as on the Scrum backlog: first choose AI suggestions
  // or a manual form.
  const [adding, setAdding] = useState(searchParams.get("create") === "1");
  const [addMode, setAddMode] = useState<"ai" | "manual" | null>(null);
  const [creating, setCreating] = useState(false);

  const closeAddPanel = () => {
    setAdding(false);
    setAddMode(null);
  };

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setAdding(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState(canAssignOthers ? "" : currentUser._id);
  // 0 = not estimated yet.
  const [storyPoints, setStoryPoints] = useState<StoryPointValue>(0);
  // The card whose "AI & estimate" panel is open, if any.
  const [toolsTaskId, setToolsTaskId] = useState<string | null>(null);

  // WIP limit: the most tasks allowed in In Progress at once (0 = no limit).
  const [wipLimit, setWipLimit] = useState(0);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState("0");
  const [savingLimit, setSavingLimit] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getProject(projectId)
      .then((project) => {
        if (!cancelled) setWipLimit(project.wipLimit ?? 0);
      })
      .catch(() => {
        // Without the project the board still works, just without a limit shown.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;

  // Board rules (the same as the Scrum board; the backend enforces them too):
  // the assignee moves their own task To Do → In Progress → Review, and a
  // tester, manager or admin signs it off to Done or sends it back with a comment.
  const signOff = canMarkDone(currentUser.role);
  const [bouncingId, setBouncingId] = useState<string | null>(null);
  const [bounceText, setBounceText] = useState("");
  const [bounceBusy, setBounceBusy] = useState(false);

  /** Why this move is not allowed, or null if it is. */
  const moveProblem = (task: Task, status: Task["status"]): string | null => {
    const flow: Task["status"][] = ["todo", "in_progress", "review", "done"];
    const next = flow[flow.indexOf(task.status) + 1];
    if (!next) return "This task is already Done.";
    if (status !== next) {
      return `Tasks move one step at a time: ${STATUS_NAMES[task.status]} → ${STATUS_NAMES[next]}.`;
    }
    if (status === "done") {
      return signOff
        ? null
        : "A task can only be marked Done by a tester, manager or admin. Please ask a tester to review it.";
    }
    if (!task.assignee) return "This task has no assignee yet. Assign it to someone before moving it.";
    if (task.assignee._id !== currentUser._id) {
      return "Only the person this task is assigned to can move it to In Progress or Review.";
    }
    return null;
  };

  // Story points: set by the person doing the task, or adjusted by a manager.
  // (The backend enforces the same rule.)
  const canEditPoints = (task: Task) =>
    canAssignOthers || (!!task.assignee && task.assignee._id === currentUser._id);

  const saveWipLimit = async () => {
    if (!projectId) return;
    const value = limitDraft.trim() === "" ? 0 : Number(limitDraft);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      alert("Please enter a whole number from 0 to 100 (0 means no limit).");
      return;
    }
    try {
      setSavingLimit(true);
      const saved = await updateProject(projectId, { wipLimit: value });
      setWipLimit(saved.wipLimit ?? value);
      setEditingLimit(false);
    } catch (err) {
      alert(readError(err, "We could not save the WIP limit."));
    } finally {
      setSavingLimit(false);
    }
  };

  const load = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError("");

      const taskRes = await fetch(`${API_URL}/tasks?project=${projectId}`);

      if (!taskRes.ok) {
        throw new Error(
          await failureMessage(taskRes, "We could not load the board. Please try again."),
        );
      }

      setTasks(await taskRes.json());
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
          storyPoints,
        }),
      });

      const created = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(created?.message || "Failed to create task");
      }
      // Developers and testers need a manager's approval before a task is created.
      if (created?.pendingApproval) alert(created.message);

      setTitle("");
      setDescription("");
      setPriority("medium");
      setAssignee(canAssignOthers ? "" : currentUser._id);
      setStoryPoints(0);
      closeAddPanel();

      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const moveTask = async (taskId: string, status: Task["status"]) => {
    const task = tasks.find((t) => t._id === taskId);
    if (!task || task.status === status) return;

    // Back from Review: a tester (or manager/admin) says what to fix first.
    if (task.status === "review" && status === "in_progress") {
      if (!signOff) {
        alert("Only a tester, manager or admin can send a task back from Review.");
        return;
      }
      setBouncingId(task._id);
      setBounceText("");
      return;
    }

    const problem = moveProblem(task, status);
    if (problem) {
      alert(problem);
      return;
    }

    // WIP limit: don't start another task while In Progress is full.
    // (The backend checks this too; this just saves a round trip.)
    if (status === "in_progress" && wipLimit > 0 && inProgressCount >= wipLimit) {
      alert(
        `In Progress is full: the limit is ${wipLimit} task${wipLimit === 1 ? "" : "s"}. ` +
          "Finish or move a task out of In Progress first" +
          (canAssignOthers ? ", or raise the limit." : ", or ask a manager to raise the limit."),
      );
      return;
    }

    // Optimistic update so the card jumps columns instantly, then
    // reconcile with the server. Reload on failure to undo it.
    setTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, status } : t))
    );

    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        alert(await failureMessage(response, "We could not move the task. Please try again."));
        await load();
      }
    } catch {
      alert("We could not reach the server, so the task was not moved.");
      await load();
    }
  };

  // Save story points or priority for one task. Throws with the server's
  // message on failure, so the AI panels can show it next to the button.
  const saveTaskField = async (
    taskId: string,
    changes: { storyPoints?: StoryPointValue; priority?: Task["priority"] },
  ) => {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
    } catch {
      throw new Error("We could not reach the server, so nothing was saved.");
    }
    if (!response.ok) {
      throw new Error(await failureMessage(response, "We could not save that. Please try again."));
    }
    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, ...changes } : t)));
  };

  // The plain story-point picker on a card (works without the AI).
  const setTaskPoints = async (taskId: string, points: StoryPointValue) => {
    try {
      await saveTaskField(taskId, { storyPoints: points });
    } catch (err) {
      alert(err instanceof Error ? err.message : "We could not save the story points.");
    }
  };

  // AI Task Suggestions: ideas for next tasks. A task is only created when
  // someone clicks "Add to To Do" (a developer's goes to a manager for approval).
  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
  const [addedSuggestions, setAddedSuggestions] = useState<Record<string, string>>({});

  const addSuggestion = async (suggestion: TaskSuggestion) => {
    if (!projectId || addingSuggestion) return;
    const key = suggestion.title;
    try {
      setAddingSuggestion(key);
      const response = await fetch(`${API_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestion.title,
          description: suggestion.description,
          priority: suggestion.priority,
          project: projectId,
        }),
      });
      const created = await response.json().catch(() => null);
      if (!response.ok) {
        alert(created?.message || "Failed to add the suggested task.");
        return;
      }
      setAddedSuggestions((prev) => ({
        ...prev,
        [key]: created?.pendingApproval ? "Sent to a manager for approval" : "Added to To Do",
      }));
      if (!created?.pendingApproval) await load();
    } catch {
      alert("We could not reach the server, so the task was not added.");
    } finally {
      setAddingSuggestion(null);
    }
  };

  const renderSuggestionActions = (suggestion: TaskSuggestion) => {
    const added = addedSuggestions[suggestion.title];
    if (added) return <p className="scrum-suggestion-added">✓ {added}</p>;
    return (
      <div className="scrum-suggestion-actions">
        <button
          type="button"
          className="primary-button"
          disabled={addingSuggestion !== null}
          onClick={() => addSuggestion(suggestion)}
        >
          {addingSuggestion === suggestion.title ? "Adding..." : "+ Add to To Do"}
        </button>
      </div>
    );
  };

  // A tester found a problem in Review: back to In Progress, with a note for the assignee.
  const sendBack = async (task: Task) => {
    const comment = bounceText.trim();
    if (!comment) {
      alert("Please write what needs to be fixed, so the developer knows.");
      return;
    }
    try {
      setBounceBusy(true);
      const response = await fetch(`${API_URL}/tasks/${task._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress", reviewComment: comment }),
      });
      if (!response.ok) {
        alert(await failureMessage(response, "Could not send the task back."));
        return;
      }
      setBouncingId(null);
      setBounceText("");
      await load();
    } catch {
      alert("We could not reach the server, so the task was not sent back.");
    } finally {
      setBounceBusy(false);
    }
  };

  // Change who a task is assigned to (managers and admins only).
  const reassign = async (taskId: string, personId: string) => {
    const person = people.find((p) => p._id === personId);
    const previous = tasks.find((t) => t._id === taskId)?.assignee;
    const assigned: User | null = person ? { ...person } : null;

    // Show the new assignee at once; put the old one back if saving fails.
    setTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, assignee: assigned } : t))
    );

    const undo = () =>
      setTasks((prev) =>
        prev.map((t) => (t._id === taskId ? { ...t, assignee: previous } : t))
      );

    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: personId || null }),
      });

      if (!response.ok) {
        undo();
        alert(await failureMessage(response, "We could not change the assignee. Please try again."));
      }
    } catch {
      undo();
      alert("We could not reach the server, so the assignee was not changed.");
    }
  };

  const columns: { key: Task["status"]; label: string }[] = [
    { key: "todo", label: "Todo" },
    { key: "in_progress", label: "In Progress" },
    { key: "review", label: "Review" },
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
            Continuous workflow — drag tasks across columns as work
            progresses.
          </p>
          <p className="kanban-rules-hint">
            Move your own tasks To Do → In Progress → Review. A tester, manager or admin signs
            them off to Done, or sends them back with a note.
          </p>

          {/* WIP limit: everyone sees it; managers and admins can change it. */}
          <div className="kanban-wip-setting">
            {!editingLimit ? (
              <>
                <span>
                  In Progress limit:{" "}
                  <strong>{wipLimit > 0 ? `${wipLimit} task${wipLimit === 1 ? "" : "s"}` : "none"}</strong>
                </span>
                {canAssignOthers && (
                  <button
                    type="button"
                    className="kanban-tools-toggle"
                    onClick={() => {
                      setLimitDraft(String(wipLimit));
                      setEditingLimit(true);
                    }}
                  >
                    {wipLimit > 0 ? "Change" : "Set a limit"}
                  </button>
                )}
              </>
            ) : (
              <>
                <label htmlFor="kanban-wip-input">In Progress limit</label>
                <input
                  id="kanban-wip-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveWipLimit();
                    if (e.key === "Escape") setEditingLimit(false);
                  }}
                />
                <span className="kanban-wip-hint">0 = no limit</span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={saveWipLimit}
                  disabled={savingLimit}
                >
                  {savingLimit ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingLimit(false)}
                  disabled={savingLimit}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
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
          {/* Hidden while the "Add a task" panel is open. */}
          {!adding && (
            <button className="primary-button" onClick={() => setAdding(true)}>
              + Create Task
            </button>
          )}
        </div>
      </div>

      {adding && (
        <section className="scrum-panel kanban-add-panel">
          <div className="scrum-panel-header">
            <h2>Add a task</h2>
            <span className="scrum-panel-meta">Choose how</span>
          </div>

          <div className="scrum-add-options">
            <button
              type="button"
              className={`scrum-add-option ${addMode === "ai" ? "selected" : ""}`}
              aria-pressed={addMode === "ai"}
              onClick={() => setAddMode(addMode === "ai" ? null : "ai")}
            >
              <strong>AI Suggestions</strong>
              <span>Let AI suggest tasks based on this board</span>
            </button>
            <button
              type="button"
              className={`scrum-add-option ${addMode === "manual" ? "selected" : ""}`}
              aria-pressed={addMode === "manual"}
              onClick={() => setAddMode(addMode === "manual" ? null : "manual")}
            >
              <strong>+ Create New Task</strong>
              <span>Create a task manually</span>
            </button>
          </div>

          {addMode === "ai" && projectId && (
            <div className="scrum-add-ai">
              <TaskSuggestions
                projectId={projectId}
                subtitle="Ideas for next tasks, based on the tasks on this board."
                renderActions={renderSuggestionActions}
              />
            </div>
          )}

          {addMode === "manual" && (
            <div className="form-card kanban-add-form">

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
              {projectId && (
                <PriorityRecommender
                  projectId={projectId}
                  title={title}
                  description={description}
                  currentPriority={priority as Task["priority"]}
                  applyLabel="Use Recommendation"
                  onApply={(value) => setPriority(value)}
                />
              )}

              <label>Story points</label>
              <select
                value={storyPoints}
                onChange={(e) => setStoryPoints(Number(e.target.value) as StoryPointValue)}
              >
                {STORY_POINT_SCALE.map((points) => (
                  <option key={points} value={points}>
                    {points === 0 ? "Not estimated" : points}
                  </option>
                ))}
              </select>
              {projectId && (
                <StoryPointEstimator
                  projectId={projectId}
                  title={title}
                  description={description}
                  priority={priority as Task["priority"]}
                  applyLabel="Use Estimate"
                  onApply={(points) => setStoryPoints(points)}
                />
              )}

              <label>Assignee</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                {canAssignOthers ? (
                  <>
                    <option value="">Unassigned</option>
                    {people.map((person) => (
                      <option key={person._id} value={person._id}>
                        {personLabel(person, currentUser._id)}
                      </option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value={currentUser._id}>Myself</option>
                    <option value="">Unassigned</option>
                  </>
                )}
              </select>

              <div className="form-actions">
                <button className="secondary-button" onClick={closeAddPanel}>
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

          {/* The manual form has its own Cancel button. */}
          {addMode !== "manual" && (
            <div className="kanban-add-close">
              <button type="button" className="secondary-button" onClick={closeAddPanel}>
                Close
              </button>
            </div>
          )}
        </section>
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
        <KanbanDndBoard
          columns={columns}
          tasks={tasks}
          onMove={(taskId, status) => moveTask(taskId, status as Task["status"])}
          limits={{ in_progress: wipLimit }}
          renderCard={(task, overlay) => (
            <>
              <h3>{task.title}</h3>
              <p>{task.description || "No description"}</p>

              <div className="task-card-meta">
                <span className={`priority-badge priority-${task.priority}`}>
                  {task.priority}
                </span>
                {task.assignee && (
                  <span className="role-badge">{task.assignee.name}</span>
                )}
                {(task.storyPoints ?? 0) > 0 && (
                  <span className="kanban-points-badge">
                    {task.storyPoints} {task.storyPoints === 1 ? "pt" : "pts"}
                  </span>
                )}
              </div>

              {/* What the tester asked to fix, while the task is back in progress. */}
              {task.reviewNote && task.status === "in_progress" && (
                <p className="scrum-review-note">
                  <strong>Sent back by {task.reviewNote.byName || "a tester"}</strong>
                  {task.reviewNote.text}
                </p>
              )}

              {/* One timer per task: the dragged copy doesn't get its own. */}
              {!overlay && <TaskTimer task={task} />}

              {!overlay && (
                // Using these controls must not start dragging the card.
                <div
                  className="kanban-card-controls"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  {task.status === "review" && !signOff && (
                    <p className="kanban-waiting">Waiting for a tester to sign off</p>
                  )}

                  {/* A tester can send work back from Review, with a comment. */}
                  {task.status === "review" && signOff && (
                    bouncingId === task._id ? (
                      <div className="scrum-bounce">
                        <textarea
                          aria-label={`What needs to be fixed in ${task.title}`}
                          placeholder="What needs to be fixed?"
                          value={bounceText}
                          maxLength={1000}
                          autoFocus
                          onChange={(e) => setBounceText(e.target.value)}
                        />
                        <div className="scrum-bounce-actions">
                          <button
                            type="button"
                            className="scrum-bounce-button"
                            disabled={bounceBusy}
                            onClick={() => sendBack(task)}
                          >
                            {bounceBusy ? "Sending…" : "Send back"}
                          </button>
                          <button
                            type="button"
                            className="sprint-card-backlog-button"
                            disabled={bounceBusy}
                            onClick={() => {
                              setBouncingId(null);
                              setBounceText("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="scrum-bounce-button"
                        onClick={() => {
                          setBouncingId(task._id);
                          setBounceText("");
                        }}
                      >
                        ↩ Found a bug? Send back
                      </button>
                    )
                  )}

                  {canAssignOthers && (
                    <select
                      className="kanban-assignee-select"
                      aria-label={`Assignee of ${task.title}`}
                      value={task.assignee?._id ?? ""}
                      onChange={(e) => reassign(task._id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {/* Keep the current assignee listed even if they have left the team. */}
                      {task.assignee && !people.some((p) => p._id === task.assignee?._id) && (
                        <option value={task.assignee._id}>{task.assignee.name}</option>
                      )}
                      {people.map((person) => (
                        <option key={person._id} value={person._id}>
                          {personLabel(person, currentUser._id)}
                        </option>
                      ))}
                    </select>
                  )}

                  {canEditPoints(task) && (
                    <button
                      type="button"
                      className="kanban-tools-toggle"
                      aria-expanded={toolsTaskId === task._id}
                      onClick={() =>
                        setToolsTaskId((open) => (open === task._id ? null : task._id))
                      }
                    >
                      {toolsTaskId === task._id ? "Hide estimate & AI ▴" : "Estimate & AI ▾"}
                    </button>
                  )}

                  {toolsTaskId === task._id && projectId && (
                    <div className="kanban-tools-panel">
                      {canEditPoints(task) && (
                        <>
                          <label className="kanban-tools-label">
                            Story points
                            <select
                              value={task.storyPoints ?? 0}
                              onChange={(e) =>
                                setTaskPoints(task._id, Number(e.target.value) as StoryPointValue)
                              }
                            >
                              {STORY_POINT_SCALE.map((points) => (
                                <option key={points} value={points}>
                                  {points === 0 ? "Not estimated" : points}
                                </option>
                              ))}
                            </select>
                          </label>

                          <StoryPointEstimator
                            projectId={projectId}
                            title={task.title}
                            description={task.description}
                            priority={task.priority}
                            taskId={task._id}
                            savedStoryPoints={task.storyPoints}
                            applyLabel="Save Estimate"
                            appliedText={(points) => `Saved ${points} story points.`}
                            onApply={(points) => saveTaskField(task._id, { storyPoints: points })}
                          />
                        </>
                      )}

                      {/* Only managers and admins may change a task's priority. */}
                      {canAssignOthers && (
                        <PriorityRecommender
                          projectId={projectId}
                          title={task.title}
                          description={task.description}
                          taskId={task._id}
                          currentPriority={task.priority}
                          applyLabel="Save Priority"
                          appliedText={(value) => `Priority set to ${value}.`}
                          onApply={(value) => saveTaskField(task._id, { priority: value })}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        />
      )}

      {/* AI Kanban Insights: board health, bottlenecks and next steps (including Review). */}
      {!loading && !error && projectId && (
        <div className="kanban-insights-slot">
          <KanbanInsights projectId={projectId} reviewEnabled={true} />
        </div>
      )}
    </div>
  );
}

// First page after login (Figma "Dashboard"): totals across all my projects.
/** A project's page. Admins have no project pages (they work from Team Members), so they go there. */
function ProjectOverviewPage() {
  const { user } = useAuth();
  return user.role === "admin" ? <Navigate to="/team" replace /> : <ProjectOverviewBody />;
}

/** Admins have no dashboard: they start on Team Members. */
function HomePage() {
  const { user } = useAuth();
  return user.role === "admin" ? <Navigate to="/team" replace /> : <DashboardPage />;
}

/** The All Projects list is not part of the admin's menu either. */
function ProjectsRoute() {
  const { user } = useAuth();
  return user.role === "admin" ? <Navigate to="/team" replace /> : <ProjectsPage />;
}

/** Admins only look at teams and reports, so the task, sprint and board pages send them to Team Members. */
function NotForAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user.role === "admin") {
    return <Navigate to="/team" replace />;
  }
  return children;
}

/** Team Members: admins see the managers and their teams, everyone else the people on their projects. */
function TeamRoute() {
  const { user } = useAuth();
  return user.role === "admin" ? <AdminTeamPage /> : <TeamPage />;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const canCreateProjects = currentUser.role === "manager";
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  // Bumped after a team request is accepted, so the new project shows up.
  const [reload, setReload] = useState(0);

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
      .then((data) => {
        setError("");
        setProjects(data);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load projects"),
      );
  }, [reload]);

  // Requests from a manager to join a team appear as a popup, even when the
  // person is not on any project yet.
  const requests = <TeamRequests onChanged={() => setReload((n) => n + 1)} />;

  if (error) {
    return (
      <div>
        {requests}
        <div className="empty-state">
          <h2>Unable to load dashboard</h2>
          <p>{error}</p>
        </div>
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
      <div>
        {requests}
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
      </div>
    );
  }
  return (
    <div>
      {requests}
      <ProjectDashboard projects={projects} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<HomePage />} />

          <Route path="/projects" element={<ProjectsRoute />} />

          <Route
            path="/projects/:projectId"
            element={<ProjectOverviewPage />}
          />

          <Route
            path="/projects/:projectId/backlog"
            element={<NotForAdmin><ScrumOnly><BacklogPage /></ScrumOnly></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/sprints"
            element={<NotForAdmin><ScrumOnly><SprintPage /></ScrumOnly></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/tasks/new"
            element={<NotForAdmin><ScrumOnly createTask><NewTaskPage /></ScrumOnly></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/kanban"
            element={<NotForAdmin><KanbanBoardPage /></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/ai-insights"
            element={<NotForAdmin><AiInsightsPage /></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/reports"
            element={<ReportsPage />}
          />

          <Route
            path="/projects/:projectId/team"
            element={<NotForAdmin><ProjectTeamPage /></NotForAdmin>}
          />

          <Route
            path="/projects/:projectId/approvals"
            element={<NotForAdmin><ApprovalsPage /></NotForAdmin>}
          />
          <Route path="/team" element={<TeamRoute />} />

          {/* A password reset link opened while already logged in. */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;