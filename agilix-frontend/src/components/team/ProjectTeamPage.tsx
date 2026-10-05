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
import {
  cancelInvite,
  getProjectInvites,
  sendInvite,
  type ProjectInvite,
} from "../../api/teamInvites";
import { initials, readError, sameId } from "../scrum/taskDisplay";
import "./team.css";

/** "developer" -> "Developer", so roles read well in lists. */
function roleLabel(role: string | undefined): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
}

/**
 * Team of one project. Everyone on the project can see it.
 *  - Admins add managers straight to the team.
 *  - Managers send a team request to developers and testers; they join once they accept.
 */
export default function ProjectTeamPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const isManager = user.role === "manager";
  const canManage = isAdmin || isManager;

  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [choice, setChoice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError("");
      const [projectData, userData, inviteData] = await Promise.all([
        getProject(projectId),
        canManage ? getUsers() : Promise.resolve([] as User[]),
        canManage ? getProjectInvites(projectId) : Promise.resolve([] as ProjectInvite[]),
      ]);
      setProject(projectData);
      setUsers(userData);
      setInvites(inviteData);
    } catch (err) {
      setError(readError(err, "Failed to load the team"));
    } finally {
      setLoading(false);
    }
  }, [projectId, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  // Owner first, then the members, each person once.
  const people: User[] = [];
  for (const person of [project?.owner, ...(project?.members ?? [])]) {
    if (person && person._id && !people.some((p) => p._id === person._id)) people.push(person);
  }

  const isOnTeam = (id: string) => people.some((p) => sameId(p, id));
  const hasRequest = (id: string) => invites.some((i) => i.invitee && sameId(i.invitee, id));

  // Admins choose managers; managers choose developers and testers.
  const addable = users.filter((u) =>
    isAdmin
      ? u.role === "manager" && !isOnTeam(u._id)
      : (u.role === "developer" || u.role === "tester") && !isOnTeam(u._id) && !hasRequest(u._id),
  );

  const add = async () => {
    if (!projectId || busy || !choice) return;
    try {
      setBusy(true);
      setError("");
      setNotice("");
      const chosen = users.find((u) => u._id === choice);
      if (isAdmin) {
        await addProjectMember(projectId, choice);
      } else {
        await sendInvite(projectId, choice);
        setNotice(
          `Request sent to ${chosen?.name ?? "the person"}. They join the team once they accept.`,
        );
      }
      setChoice("");
      await load();
    } catch (err) {
      setError(readError(err, isAdmin ? "Failed to add the manager" : "Failed to send the request"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: User) => {
    if (!projectId || busy) return;
    try {
      setBusy(true);
      setError("");
      setNotice("");
      await removeProjectMember(projectId, member._id);
      await load();
    } catch (err) {
      setError(readError(err, "Failed to remove the member"));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (invite: ProjectInvite) => {
    if (busy) return;
    try {
      setBusy(true);
      setError("");
      setNotice("");
      await cancelInvite(invite._id);
      await load();
    } catch (err) {
      setError(readError(err, "Failed to withdraw the request"));
    } finally {
      setBusy(false);
    }
  };

  // Admins remove managers; managers remove developers and testers, never themselves.
  const canRemove = (member: User) => {
    if (sameId(member, project?.owner)) return false;
    if (sameId(member, user._id)) return false;
    if (isAdmin) return true;
    return isManager && member.role !== "manager" && member.role !== "admin";
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
              ? `Add the manager of ${project.name}. The manager then asks developers and testers to join.`
              : isManager
                ? `Ask developers and testers to join ${project.name}. They join once they accept.`
                : `People working on ${project.name}.`}
          </p>
        </div>
      </div>

      {canManage && (
        <div className="form-card">
          <label htmlFor="member-choice">
            {isAdmin ? "Add a manager" : "Send a team request"}
          </label>
          <div className="member-invite">
            <select
              id="member-choice"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">
                {isAdmin ? "Select a manager" : "Select a developer or tester"}
              </option>
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
              {isAdmin ? "Add" : "Send request"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="member-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="team-requests-notice">{notice}</p>}

      {canManage && invites.length > 0 && (
        <section className="team-pending">
          <h2>
            Waiting for an answer <span className="team-requests-count">{invites.length}</span>
          </h2>
          {invites.map((invite) => (
            <div className="team-pending-row" key={invite._id}>
              <span>
                <strong>{invite.invitee?.name ?? "Someone"}</strong>
                {invite.invitee?.role ? ` · ${roleLabel(invite.invitee.role)}` : ""}
                {invite.invitedBy ? ` · asked by ${invite.invitedBy.name}` : ""}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => withdraw(invite)}
              >
                Withdraw
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="project-team-grid">
        {people.map((member) => {
          const isMe = sameId(member, user._id);
          const isOwner = sameId(member, project.owner);
          return (
            <div className="project-team-card" key={member._id}>
              <div className="project-team-card-top">
                <div className="team-avatar">{initials(member.name)}</div>
                <div className="project-team-info">
                  <h2>{member.name}</h2>
                  <p className="project-team-email">{member.email}</p>
                </div>
              </div>
              <div className="project-team-tags">
                <span className="role-badge">{roleLabel(member.role)}</span>
                {isOwner && <span className="role-badge role-badge-owner">Owner</span>}
                {isMe && <span className="project-team-me">Myself</span>}
              </div>
              {canRemove(member) && (
                <button
                  className="secondary-button project-team-remove"
                  onClick={() => remove(member)}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {people.length <= 1 && (
        <p className="page-description">
          {isAdmin
            ? "No manager yet. Add one above."
            : isManager
              ? "No other team members yet. Send a request above."
              : "No other team members yet."}
        </p>
      )}
    </div>
  );
}
