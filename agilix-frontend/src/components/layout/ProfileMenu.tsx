import { useEffect, useRef, useState } from "react";
import { initialOf, useAuth } from "../../auth/auth-context";
import { getUser, setMyGithubUsername } from "../../api/users";
import CalendarConnect from "../integrations/CalendarConnect";
import "./profile-menu.css";

/** "developer" → "Developer" */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Profile icon in the top bar. Clicking it opens a small card with the
 * person's name, email and role, and a "Log out" button.
 */
export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [github, setGithub] = useState("");
  const [savedGithub, setSavedGithub] = useState("");
  const [githubStatus, setGithubStatus] = useState("");
  const [savingGithub, setSavingGithub] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Load the linked GitHub username each time the card opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGithubStatus("");
    getUser(user._id)
      .then((me) => {
        if (cancelled) return;
        setGithub(me.githubUsername ?? "");
        setSavedGithub(me.githubUsername ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, user._id]);

  const saveGithub = async () => {
    const value = github.trim().replace(/^@/, "");
    try {
      setSavingGithub(true);
      setGithubStatus("");
      const me = await setMyGithubUsername(value);
      setGithub(me.githubUsername ?? "");
      setSavedGithub(me.githubUsername ?? "");
      setGithubStatus(value ? "Saved" : "Removed");
    } catch (err) {
      setGithubStatus(readMessage(err));
    } finally {
      setSavingGithub(false);
    }
  };

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-avatar profile-menu-trigger"
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name}
        onClick={() => setOpen((value) => !value)}
      >
        {initialOf(user.name)}
      </button>

      {open && (
        <div className="profile-menu-card" role="menu">
          <div className="profile-menu-head">
            <div className="topbar-avatar">{initialOf(user.name)}</div>
            <div className="profile-menu-info">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <span className="role-badge">{roleLabel(user.role)}</span>
            </div>
          </div>

          <div className="profile-menu-github">
            <label htmlFor="profile-github">GitHub username</label>
            <div className="profile-menu-github-row">
              <input
                id="profile-github"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="e.g. octocat"
                maxLength={40}
              />
              <button
                type="button"
                onClick={saveGithub}
                disabled={savingGithub || github.trim().replace(/^@/, "") === savedGithub}
              >
                {savingGithub ? "..." : "Save"}
              </button>
            </div>
            <small>{githubStatus || "Links your commits and pull requests to you."}</small>
          </div>

          <CalendarConnect />

          <button
            type="button"
            className="profile-menu-logout"
            role="menuitem"
            onClick={logout}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

/** The backend sends errors as JSON ({ message }); show just the message. */
function readMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(" ");
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  return raw || "Could not save";
}
