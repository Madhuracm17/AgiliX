import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { initialOf, useAuth } from "../../auth/auth-context";
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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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

          <button
            type="button"
            className="profile-menu-link"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/team");
            }}
          >
            Team
          </button>

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
