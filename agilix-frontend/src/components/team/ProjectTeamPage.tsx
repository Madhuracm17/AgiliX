import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { getUsers, type User } from "../../api/users";
import {
  addProjectMember,
  getProject,
  removeProjectMember,
  type Project,
} from "../../api/projects";
import { initials, readError, sameId } from "../scrum/taskDisplay";
import "./team.css";

/** "developer" -> "Developer", so roles read well in lists. */
function roleLabel(role: string | undefined): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
}

/**
 * Team of one project. Everyone on the project can see it; only admins and managers can
 * add or remove people.
 */
export default function ProjectTeamPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user.role === "admin" || user.role === "manager";

  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [choice, setChoice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError("");
      const [projectData, userData] = await Promise.all([
        getProject(projectId),
        isAdmin ? getUsers() : Promise.resolve([] as User[]),
      ]);
      setProject(projectData);
      setUsers(userData);
    } catch (err) {
      setError(readError(err, "Failed to load the team"));
    } finally {
      setLoading(false);
    }
  }, [projectId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const members = project?.members ?? [];
  const isOnTeam = (id: string) =>
    sameId(project?.owner, id) || members.some((m) => sameId(m, id));

  // Roles come from the people list, which only admins and managers load.
  const roleOf = (id: string) => roleLabel(users.find((u) => sameId(u, id))?.role);

  // People who are registered but not yet on this project.
  const addable = users.filter((u) => !isOnTeam(u._id));

  const add = async () => {
    if (!projectId || busy || !choice) return;
    try {
      setBusy(true);
      setError("");
      await addProjectMember(projectId, choice);
      setChoice("");
      await load();
    } catch (err) {
      setError(readError(err, "Failed to add the member"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: User) => {
    if (!projectId || busy) return;
    try {
      setBusy(true);
      setError("");
      await removeProjectMember(projectId, member._id);
      await load();
    } catch (err) {
      setError(readError(err, "Failed to remove the member"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading team...</h2>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="empty-state">
        <h2>Unable to load team</h2>
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
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Project
          </p>
          <h1>Team</h1>
          <p className="page-description">
            {isAdmin
              ? `Choose who is on ${project.name}.`
              : `People working on ${project.name}.`}
          </p>
        </div>
      </div>

      {isAdmin && (
        <div className="form-card">
          <label htmlFor="member-choice">Add a team member</label>
          <div className="member-invite">
            <select
              id="member-choice"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Select a person</option>
              {addable.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} · {roleLabel(u.role)} · {u.email}
                </option>
              ))}
            </select>
            <button
              className="primary-button"
              onClick={add}
              disabled={busy || !choice}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="member-error" role="alert">
          {error}
        </p>
      )}

      <div className="project-team-list">
        {project.owner && (
          <div className="project-team-row">
            <div className="team-avatar">{initials(project.owner.name)}</div>
            <div className="project-team-info">
              <h2>{project.owner.name}</h2>
              <p>
                {project.owner.email}
                {roleOf(project.owner._id) && ` · ${roleOf(project.owner._id)}`}
              </p>
            </div>
            <span className="role-badge">Owner</span>
          </div>
        )}

        {members
          .filter((m) => !sameId(m, project.owner))
          .map((member) => (
            <div className="project-team-row" key={member._id}>
              <div className="team-avatar">{initials(member.name)}</div>
              <div className="project-team-info">
                <h2>{member.name}</h2>
                <p>
                  {member.email}
                  {roleOf(member._id) && ` · ${roleOf(member._id)}`}
                </p>
              </div>
              {isAdmin && (
                <button
                  className="secondary-button"
                  onClick={() => remove(member)}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </div>
          ))}

        {members.filter((m) => !sameId(m, project.owner)).length === 0 && (
          <p className="page-description">
            {isAdmin
              ? "No team members yet. Add someone above."
              : "No other team members yet."}
          </p>
        )}
      </div>
    </div>
  );
}
