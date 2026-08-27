import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
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

        <button
          className="primary-button"
          onClick={() => setShowForm(true)}
        >
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
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
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
                {project.description ||
                  "No project description available."}
              </p>

              <div className="project-card-footer">
                <span>
                  {project.members?.length || 0} member
                  {project.members?.length === 1 ? "" : "s"}
                </span>

                {project.owner && (
                  <span>Owner: {project.owner.name}</span>
                )}
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

        <button
          className="primary-button"
          onClick={() => setShowForm(true)}
        >
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
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
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
  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">PROJECT</p>
          <h1>AgiliX</h1>
          <p className="page-description">
            AI-powered Agile Project Management Platform
          </p>
        </div>

        <button className="primary-button">+ Create Task</button>
      </div>

      <div className="project-info-card">
        <div>
          <span className="eyebrow">OWNER</span>
          <h3>Madhura</h3>
          <p>madhura@example.com</p>
        </div>

        <div>
          <span className="eyebrow">TEAM MEMBERS</span>
          <h3>0</h3>
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
            Manage your product backlog, create tasks and prioritize upcoming
            work.
          </p>

          <button className="secondary-button">View Backlog</button>
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

          <button className="secondary-button">View Sprint</button>
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

          <button className="secondary-button">Manage Team</button>
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

          <button className="secondary-button">View Reports</button>
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

          <button className="secondary-button">View AI Insights</button>
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

          <button className="secondary-button">Open Actions</button>
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="/"
            element={<Navigate to="/projects" replace />}
          />

          <Route
            path="/projects"
            element={<ProjectsPage />}
          />

          <Route
            path="/projects/:projectId"
            element={<ProjectOverviewPage />}
          />

          <Route
            path="/team"
            element={<TeamPage />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;