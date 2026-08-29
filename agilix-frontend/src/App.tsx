import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import AppShell from "./components/layout/AppShell";

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
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  project: string;
  sprint?: string | null;
  assignee?: User | null;
  storyPoints?: number;
};

type Sprint = {
  _id: string;
  name: string;
  project: string;
  startDate: string;
  endDate: string;
  status: string;
};

type SprintStats = {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
};

type SprintRisk = {
  risk: "green" | "yellow" | "red";
  reasoning: string;
  completionForecastPercent: number;
};

function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");

  const navigate = useNavigate();

  const loadProjects = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/projects`);

      if (!response.ok) {
        throw new Error("Failed to load projects");
      }

      const data = await response.json();
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/users`);

      if (!response.ok) {
        throw new Error("Failed to load users");
      }

      const data = await response.json();
      setUsers(data);

      if (data.length > 0) {
        setOwner(data[0]._id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadProjects();
    loadUsers();
  }, []);

  const createProject = async () => {
    if (!name.trim()) {
      alert("Please enter a project name.");
      return;
    }

    if (!owner) {
      alert("Please create a team member first.");
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
          owner,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create project");
      }

      setName("");
      setDescription("");
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
          <p className="eyebrow">WORKSPACE</p>
          <h1>Projects</h1>
          <p className="page-description">
            Manage your Agile projects and teams.
          </p>
        </div>

        <button className="primary-button" onClick={() => setShowForm(true)}>
          + New Project
        </button>
      </div>

      {showForm && (
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

          <label>Project owner</label>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Select owner</option>

            {users.map((user) => (
              <option key={user._id} value={user._id}>
                {user.name} ({user.email})
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
          <p>Create your first AgiliX project to get started.</p>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="project-grid">
          {projects.map((project) => (
            <div
              className="project-card"
              key={project._id}
              onClick={() => navigate(`/projects/${project._id}`)}
            >
              <div className="project-card-icon">
                {project.name.charAt(0).toUpperCase()}
              </div>

              <h2>{project.name}</h2>

              <p>
                {project.description || "No project description available."}
              </p>

              <div className="project-card-footer">
                <span>
                  {project.members?.length || 0} member
                  {project.members?.length === 1 ? "" : "s"}
                </span>

                {project.owner && <span>Owner: {project.owner.name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");

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

  const createUser = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      alert("Please fill all fields.");
      return;
    }

    try {
      setCreating(true);

      const response = await fetch(`${API_URL}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create user");
      }

      setName("");
      setEmail("");
      setPassword("");
      setRole("developer");
      setShowForm(false);

      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Team</h1>
          <p className="page-description">
            Manage members of your AgiliX workspace.
          </p>
        </div>

        <button className="primary-button" onClick={() => setShowForm(true)}>
          + Add Member
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>Add Team Member</h2>

          <label>Name</label>
          <input
            type="text"
            placeholder="Enter name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Email</label>
          <input
            type="email"
            placeholder="Enter email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>Password</label>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="developer">Developer</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
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
              onClick={createUser}
              disabled={creating}
            >
              {creating ? "Creating..." : "Add Member"}
            </button>
          </div>
        </div>
      )}

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
        throw new Error("Failed to load project");
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
          <p className="eyebrow">PROJECT</p>
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
          <h3>Active</h3>
          <p>Currently in development</p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">BACKLOG</span>
              <h2>Tasks</h2>
            </div>

            <span className="dashboard-icon">📋</span>
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

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">SPRINT</span>
              <h2>Active Sprint</h2>
            </div>

            <span className="dashboard-icon">🏃</span>
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

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">TEAM</span>
              <h2>Members</h2>
            </div>

            <span className="dashboard-icon">👥</span>
          </div>

          <p>
            View project members and manage task assignments across your
            Agile team.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate("/team")}
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

            <span className="dashboard-icon">📊</span>
          </div>

          <p>
            Track sprint velocity, completion progress and project
            performance.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/reports`)}
          >
            View Reports
          </button>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">AI INSIGHTS</span>
              <h2>Sprint Risk</h2>
            </div>

            <span className="dashboard-icon">🤖</span>
          </div>

          <p>
            Use AI to identify sprint risks and predict whether your team
            can complete planned work.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/ai-insights`)}
          >
            View AI Insights
          </button>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">PROJECT</span>
              <h2>Quick Actions</h2>
            </div>

            <span className="dashboard-icon">🚀</span>
          </div>

          <p>
            Quickly create tasks, start a sprint or add members to your
            project.
          </p>

          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/backlog`)}
          >
            Open Actions
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

function BacklogPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

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
        fetch(`${API_URL}/tasks/backlog?project=${projectId}`),
        fetch(`${API_URL}/users`),
      ]);

      if (!taskRes.ok) {
        throw new Error("Failed to load backlog");
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
          <h1>Backlog</h1>
          <p className="page-description">
            Tasks not yet assigned to a sprint.
          </p>
        </div>

        <button className="primary-button" onClick={() => setShowForm(true)}>
          + Create Task
        </button>
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
          <h2>Loading backlog...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load backlog</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="empty-state">
          <h2>Backlog is empty</h2>
          <p>Create your first task to get started.</p>
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div className="task-list">
          {tasks.map((task) => (
            <div className="task-card" key={task._id}>
              <div>
                <h2>{task.title}</h2>
                <p>{task.description || "No description"}</p>
              </div>

              <div className="task-card-meta">
                <span className={`priority-badge priority-${task.priority}`}>
                  {task.priority}
                </span>
                <span className="status-badge">
                  {task.status.replace("_", " ")}
                </span>
                {task.assignee && (
                  <span className="role-badge">{task.assignee.name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SprintPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(
    null
  );
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<SprintStats | null>(null);

  const loadSprints = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/sprints?project=${projectId}`);

      if (!response.ok) {
        throw new Error("Failed to load sprints");
      }

      const data = await response.json();
      setSprints(data);

      if (data.length > 0) {
        setSelectedSprintId(data[0]._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSprints();
  }, [projectId]);

  const loadSprintDetails = async (sprintId: string) => {
    try {
      const [taskRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/tasks/sprint/${sprintId}`),
        fetch(`${API_URL}/tasks/sprint/${sprintId}/stats`),
      ]);

      if (taskRes.ok) setSprintTasks(await taskRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (selectedSprintId) {
      loadSprintDetails(selectedSprintId);
    }
  }, [selectedSprintId]);

  const createSprint = async () => {
    if (!name.trim() || !startDate || !endDate) {
      alert("Please fill all fields.");
      return;
    }

    try {
      setCreating(true);

      const response = await fetch(`${API_URL}/sprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          project: projectId,
          startDate,
          endDate,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create sprint");
      }

      setName("");
      setStartDate("");
      setEndDate("");
      setShowForm(false);

      await loadSprints();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create sprint");
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
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Back to project
          </p>
          <h1>Sprints</h1>
          <p className="page-description">
            Plan sprints and track progress toward your sprint goal.
          </p>
        </div>

        <button className="primary-button" onClick={() => setShowForm(true)}>
          + New Sprint
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>Create Sprint</h2>

          <label>Sprint name</label>
          <input
            type="text"
            placeholder="Sprint 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />

          <label>End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>

            <button
              className="primary-button"
              onClick={createSprint}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create Sprint"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <h2>Loading sprints...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load sprints</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && sprints.length === 0 && (
        <div className="empty-state">
          <h2>No sprints yet</h2>
          <p>Create your first sprint to start planning.</p>
        </div>
      )}

      {!loading && !error && sprints.length > 0 && (
        <>
          <div className="sprint-tabs">
            {sprints.map((sprint) => (
              <button
                key={sprint._id}
                className={`sprint-tab ${
                  selectedSprintId === sprint._id ? "active" : ""
                }`}
                onClick={() => setSelectedSprintId(sprint._id)}
              >
                {sprint.name}
              </button>
            ))}
          </div>

          {stats && (
            <div className="project-info-card">
              <div>
                <span className="eyebrow">TOTAL TASKS</span>
                <h3>{stats.total}</h3>
              </div>
              <div>
                <span className="eyebrow">DONE</span>
                <h3>{stats.done}</h3>
              </div>
              <div>
                <span className="eyebrow">IN PROGRESS</span>
                <h3>{stats.inProgress}</h3>
              </div>
              <div>
                <span className="eyebrow">STORY POINTS</span>
                <h3>
                  {stats.completedStoryPoints}/{stats.totalStoryPoints}
                </h3>
              </div>
            </div>
          )}

          <div className="task-list">
            {sprintTasks.map((task) => (
              <div className="task-card" key={task._id}>
                <div>
                  <h2>{task.title}</h2>
                  <p>{task.description || "No description"}</p>
                </div>

                <div className="task-card-meta">
                  <span
                    className={`priority-badge priority-${task.priority}`}
                  >
                    {task.priority}
                  </span>
                  <span className="status-badge">
                    {task.status.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}

            {sprintTasks.length === 0 && (
              <p className="page-description">
                No tasks in this sprint yet. Add tasks from the backlog.
              </p>
            )}
          </div>
        </>
      )}
    </div>
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
          throw new Error("Failed to load sprints");
        }

        const data = await response.json();
        setSprints(data);

        if (data.length > 0) {
          setSelectedSprintId(data[0]._id);
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
        throw new Error("Failed to get AI risk prediction");
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
          <h2>No sprints yet</h2>
          <p>Create a sprint first to run a risk check.</p>
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

function ReportsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

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
          <h1>Reports</h1>
          <p className="page-description">
            Sprint velocity and project performance analytics.
          </p>
        </div>
      </div>

      <div className="empty-state">
        <h2>Reports are coming soon</h2>
        <p>
          This will show sprint velocity, completion trends and team
          workload once the reporting module is built.
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />

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
            path="/projects/:projectId/ai-insights"
            element={<AiInsightsPage />}
          />

          <Route
            path="/projects/:projectId/reports"
            element={<ReportsPage />}
          />

          <Route path="/team" element={<TeamPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;