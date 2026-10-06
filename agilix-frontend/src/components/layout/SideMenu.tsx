import { useCallback, useEffect, useState } from "react";
import { NavLink, matchPath, useLocation, useNavigate } from "react-router-dom";
import { getProjects, type Project } from "../../api/projects";
import { initialOf, useAuth } from "../../auth/auth-context";
import "./side-menu.css";

interface SideMenuProps {
  open: boolean;
  onClose: () => void;
}

/** The page of a project's board: the Scrum board, or the Kanban board for Kanban projects. */
function boardPath(project: Pick<Project, "_id" | "methodology">): string {
  return `/projects/${project._id}/${(project.methodology ?? "scrum") === "kanban" ? "kanban" : "sprints"}`;
}

function readLastProject(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function saveLastProject(storageKey: string, projectId: string) {
  try {
    localStorage.setItem(storageKey, projectId);
  } catch {
    // Storage can be blocked; "Scrum Board" then opens the first project instead.
  }
}

/**
 * The menu that slides in from the left when the three-line button in the top bar
 * is pressed (like the Gmail menu): Dashboard, Scrum Board, Team Members and
 * All Projects (admins get only Team Members and All Projects), with every project listed under All Projects.
 *
 * Scrum Board opens the board of the project the person looked at last (or the
 * first project if they have not opened one yet).
 */
export default function SideMenu({ open, onClose }: SideMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user.role === "admin";
  const storageKey = `agilix.lastProject.${user._id}`;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [lastProjectId, setLastProjectId] = useState<string | null>(() =>
    readLastProject(storageKey),
  );

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await getProjects());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Load once when the app opens, and again each time the menu is opened so new
  // projects show up.
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    if (open) loadProjects();
  }, [open, loadProjects]);

  // Remember which project the person is looking at.
  useEffect(() => {
    const match = matchPath("/projects/:projectId/*", location.pathname);
    const id = match?.params.projectId;
    if (id) {
      setLastProjectId(id);
      saveLastProject(storageKey, id);
    }
  }, [location.pathname, storageKey]);

  // Close after going to another page, and when Escape is pressed.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const boardTarget =
    projects.find((p) => p._id === lastProjectId) ?? projects[0] ?? null;
  const onBoard = /^\/projects\/[^/]+\/(sprints|kanban)$/.test(location.pathname);

  const openBoard = () => {
    // With no project yet, the Projects page explains what to do.
    navigate(boardTarget ? boardPath(boardTarget) : "/projects");
    onClose();
  };

  return (
    <>
      <div
        className={`side-menu-scrim ${open ? "side-menu-scrim-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="side-menu"
        className={`side-menu ${open ? "side-menu-open" : ""}`}
        aria-label="Main menu"
        aria-hidden={!open}
      >
        <div className="side-menu-head">
          <span className="logo-mark">A</span>
          <strong>AgiliX</strong>
        </div>

        <nav className="side-menu-nav">
          {!isAdmin && (
            <>
              <NavLink
                to="/dashboard"
                tabIndex={open ? 0 : -1}
                className={({ isActive }) => `side-menu-link ${isActive ? "active" : ""}`}
              >
                Dashboard
              </NavLink>

              <button
                type="button"
                tabIndex={open ? 0 : -1}
                className={`side-menu-link ${onBoard ? "active" : ""}`}
                onClick={openBoard}
              >
                Scrum Board
              </button>
            </>
          )}

          <NavLink
            to="/team"
            tabIndex={open ? 0 : -1}
            className={({ isActive }) => `side-menu-link ${isActive ? "active" : ""}`}
          >
            Team Members
          </NavLink>

          {!isAdmin && (
            <div className="side-menu-group">
              <div className="side-menu-group-row">
                <NavLink
                  to="/projects"
                  end
                  tabIndex={open ? 0 : -1}
                  className={({ isActive }) => `side-menu-link ${isActive ? "active" : ""}`}
                >
                  All Projects
                </NavLink>
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  className="side-menu-toggle"
                  aria-label={projectsOpen ? "Hide the project list" : "Show the project list"}
                  aria-expanded={projectsOpen}
                  onClick={() => setProjectsOpen((value) => !value)}
                >
                  {projectsOpen ? "▴" : "▾"}
                </button>
              </div>

              {projectsOpen && (
                <ul className="side-menu-projects">
                  {!loaded && <li className="side-menu-note">Loading projects…</li>}
                  {loaded && failed && (
                    <li className="side-menu-note">We could not load your projects.</li>
                  )}
                  {loaded && !failed && projects.length === 0 && (
                    <li className="side-menu-note">No projects yet.</li>
                  )}
                  {projects.map((project) => (
                    <li key={project._id}>
                      <NavLink
                        to={`/projects/${project._id}`}
                        tabIndex={open ? 0 : -1}
                        title={project.name}
                        className={({ isActive }) =>
                          `side-menu-project ${isActive ? "active" : ""}`
                        }
                      >
                        {project.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </nav>

        <div className="side-menu-foot">
          <div className="topbar-avatar">{initialOf(user.name)}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
