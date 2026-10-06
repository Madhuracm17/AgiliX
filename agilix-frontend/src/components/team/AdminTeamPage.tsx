import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  addProjectMember,
  getProjects,
  removeProjectMember,
  type Project,
} from "../../api/projects";
import { getJoinedInvites, type JoinedInvite } from "../../api/teamInvites";
import { getUsers, setUserRole, type User } from "../../api/users";
import { useAuth } from "../../auth/auth-context";
import { initials, readError, sameId } from "../scrum/taskDisplay";
import { projectPeople, teamOfManager } from "./managerTeam";
import "./team.css";

function roleLabel(role: string | undefined): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
}

/**
 * Team Members for an admin (their home page): every manager. Clicking a manager
 * shows the developers and testers on that manager's team, project by project.
 * "Open projects" opens the team reports (with a project picker), and clicking a
 * developer or tester opens their own report for that project (read only). The
 * admin also adds a manager to a project, removes one, and changes roles here.
 */
export default function AdminTeamPage() {
  const navigate = useNavigate();
  const { user: me } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [joinedByProject, setJoinedByProject] = useState<Record<string, JoinedInvite[]>>({});
  // Coming back from a report keeps the manager that was open.
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("manager"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addManagerId, setAddManagerId] = useState("");
  const [addProjectId, setAddProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setError("");
      const [userData, projectData] = await Promise.all([getUsers(), getProjects()]);
      setUsers(userData);
      setProjects(projectData);
    } catch (err) {
      setError(readError(err, "Failed to load the managers"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const managers = users.filter((u) => u.role === "manager");
  const selected = managers.find((m) => m._id === selectedId) ?? null;
  const selectedProjects = selected
    ? projects.filter((p) => projectPeople(p).some((person) => sameId(person, selected._id)))
    : [];

  // Who asked whom, for the projects of the chosen manager.
  useEffect(() => {
    if (!selected) return;
    for (const project of selectedProjects) {
      if (joinedByProject[project._id]) continue;
      getJoinedInvites(project._id)
        .then((rows) => setJoinedByProject((cur) => ({ ...cur, [project._id]: rows })))
        .catch(() => setJoinedByProject((cur) => ({ ...cur, [project._id]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, projects]);

  const changeRole = async (target: User, role: User["role"]) => {
    try {
      await setUserRole(target._id, role);
      setError("");
      await load();
    } catch (err) {
      setError(readError(err, "Failed to change the role"));
    }
  };

  const addToProject = async () => {
    if (!addManagerId || !addProjectId || busy) return;
    try {
      setBusy(true);
      setError("");
      await addProjectMember(addProjectId, addManagerId);
      const name = users.find((u) => u._id === addManagerId)?.name ?? "The manager";
      const projectName = projects.find((p) => p._id === addProjectId)?.name ?? "the project";
      setNotice(`${name} was added to ${projectName}.`);
      setAddProjectId("");
      setSelectedId(addManagerId);
      await load();
    } catch (err) {
      setError(readError(err, "Failed to add the manager"));
    } finally {
      setBusy(false);
    }
  };

  const removeFromProject = async (manager: User, project: Project) => {
    if (busy) return;
    if (!window.confirm(`Remove ${manager.name} from ${project.name}?`)) return;
    try {
      setBusy(true);
      setError("");
      await removeProjectMember(project._id, manager._id);
      setNotice(`${manager.name} was removed from ${project.name}.`);
      await load();
    } catch (err) {
      setError(readError(err, "Failed to remove the manager"));
    } finally {
      setBusy(false);
    }
  };

  const roleSelect = (person: User) =>
    person._id !== me._id && (
      <select
        className="role-select"
        aria-label={`Role of ${person.name}`}
        value={person.role}
        onChange={(e) => changeRole(person, e.target.value as User["role"])}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="admin">Admin</option>
        <option value="manager">Manager</option>
        <option value="developer">Developer</option>
        <option value="tester">Tester</option>
      </select>
    );

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading managers...</h2>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-description">
            Every manager in your workspace. Click a manager to see their team and projects.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            className="secondary-button"
            onClick={() => {
              setShowAdd((v) => !v);
              setNotice("");
              setAddManagerId(selectedId ?? "");
            }}
          >
            Add manager to a project
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="form-card admin-manager-panel">
          <label>Add a manager to a project</label>
          <div className="member-invite">
            <select value={addManagerId} onChange={(e) => setAddManagerId(e.target.value)} aria-label="Manager">
              <option value="">Select a manager</option>
              {managers.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name} · {m.email}
                </option>
              ))}
            </select>
            <select value={addProjectId} onChange={(e) => setAddProjectId(e.target.value)} aria-label="Project">
              <option value="">Select a project</option>
              {projects
                .filter((p) => !addManagerId || !projectPeople(p).some((x) => sameId(x, addManagerId)))
                .map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <button
              className="primary-button"
              onClick={addToProject}
              disabled={busy || !addManagerId || !addProjectId}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {notice && <p className="team-requests-notice">{notice}</p>}

      {error && (
        <p className="member-error" role="alert">
          {error}
        </p>
      )}

      {managers.length === 0 ? (
        <div className="empty-state">
          <h2>No managers yet</h2>
          <p>Accounts with the manager role appear here.</p>
        </div>
      ) : (
        <div className="project-team-grid">
          {managers.map((manager) => {
            const isSelected = manager._id === selectedId;
            return (
              <div
                role="button"
                tabIndex={0}
                key={manager._id}
                className={`project-team-card admin-manager-card ${isSelected ? "admin-manager-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedId(isSelected ? null : manager._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(isSelected ? null : manager._id);
                  }
                }}
              >
                <div className="project-team-card-top">
                  <div className="team-avatar">{initials(manager.name)}</div>
                  <div className="project-team-info">
                    <h2>{manager.name}</h2>
                    <p className="project-team-email">{manager.email}</p>
                  </div>
                </div>
                <div className="project-team-tags">
                  <span className="role-badge">Manager</span>
                  {roleSelect(manager)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <section className="admin-team-section">
          <div className="admin-project-head">
            <h2 className="admin-section-title">Team of {selected.name}</h2>
            {selectedProjects.length > 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  navigate(`/projects/${selectedProjects[0]._id}/reports?manager=${selected._id}`)
                }
              >
                Open projects
              </button>
            )}
          </div>
          {selectedProjects.length === 0 ? (
            <p className="page-description">This manager is not on any project yet.</p>
          ) : (
            selectedProjects.map((project) => {
              const team = teamOfManager(project, joinedByProject[project._id] ?? [], selected);
              return (
                <div key={project._id} className="admin-project-group">
                  <div className="admin-project-head">
                    <h3 className="admin-project-name">{project.name}</h3>
                    <div className="admin-project-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => removeFromProject(selected, project)}
                      >
                        Remove manager
                      </button>
                    </div>
                  </div>
                  {team.length === 0 ? (
                    <p className="page-description">No developers or testers on this team yet.</p>
                  ) : (
                    <div className="project-team-grid">
                      {team.map((member) => (
                        <div
                          className="project-team-card admin-member-card"
                          key={member._id}
                          role="link"
                          tabIndex={0}
                          title={`Open ${member.name}'s report`}
                          onClick={() => navigate(`/projects/${project._id}/reports?user=${member._id}&manager=${selected._id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") navigate(`/projects/${project._id}/reports?user=${member._id}&manager=${selected._id}`);
                          }}
                        >
                          <div className="project-team-card-top">
                            <div className="team-avatar">{initials(member.name)}</div>
                            <div className="project-team-info">
                              <h2>{member.name}</h2>
                              <p className="project-team-email">{member.email}</p>
                            </div>
                          </div>
                          <div className="project-team-tags">
                            <span className="role-badge">{roleLabel(member.role)}</span>
                            {roleSelect(member)}
                          </div>
                          <p className="project-team-manager">Click to open the report</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
