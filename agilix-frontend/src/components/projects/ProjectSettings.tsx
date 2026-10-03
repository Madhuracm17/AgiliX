import { useState } from "react";
import {
  deleteProject,
  PROJECT_STATUS_LABELS,
  updateProject,
  type ProjectStatus,
} from "../../api/projects";
import { useAuth } from "../../auth/auth-context";
import { readError } from "../scrum/taskDisplay";
import "./project-settings.css";

/** The few fields this panel needs, so any page's project object can be passed in. */
interface SettingsProject {
  _id: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  owner?: { _id: string } | null;
}

interface ProjectSettingsProps<T extends SettingsProject> {
  project: T;
  /** Called with the project (changed fields filled in) after an edit. */
  onSaved: (project: T) => void;
  /** Called after the project has been deleted. */
  onDeleted: () => void;
}

/**
 * Edit and delete buttons for a project, shown on the project overview.
 * Admins and managers can edit. Only an admin or the project's owner can delete.
 * The backend checks the same rules, so hiding a button is only for convenience.
 */
export default function ProjectSettings<T extends SettingsProject>({
  project,
  onSaved,
  onDeleted,
}: ProjectSettingsProps<T>) {
  const { user } = useAuth();
  const canEdit = user.role === "admin" || user.role === "manager";
  const ownerId = project.owner?._id ?? "";
  const canDelete = user.role === "admin" || (user.role === "manager" && ownerId === user._id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!canEdit) return null;

  const open = () => {
    setName(project.name);
    setDescription(project.description ?? "");
    setStatus(project.status ?? "active");
    setError("");
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Please enter a project name.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const saved = await updateProject(project._id, { name, description, status });
      onSaved({
        ...project,
        name: saved.name,
        description: saved.description,
        status: saved.status,
      });
      setEditing(false);
    } catch (err) {
      setError(readError(err, "Failed to save the project"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const sure = window.confirm(
      `Delete "${project.name}"?\n\nThis also deletes all of its tasks, sprints and tracked time. This cannot be undone.`,
    );
    if (!sure) return;
    try {
      await deleteProject(project._id);
      onDeleted();
    } catch (err) {
      alert(readError(err, "Failed to delete the project"));
    }
  };

  return (
    <div className="project-settings">
      {!editing ? (
        <div className="project-settings-actions">
          <button className="secondary-button" onClick={open}>
            Edit project
          </button>
          {canDelete && (
            <button className="secondary-button project-settings-delete" onClick={remove}>
              Delete project
            </button>
          )}
        </div>
      ) : (
        <div className="project-settings-form">
          <label>
            <span>Project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((key) => (
                <option key={key} value={key}>
                  {PROJECT_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="project-settings-error" role="alert">
              {error}
            </p>
          )}
          <div className="project-settings-actions">
            <button className="primary-button" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button className="secondary-button" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
