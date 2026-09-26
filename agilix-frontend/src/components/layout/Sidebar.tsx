import { NavLink } from "react-router-dom";
import { initialOf, useAuth } from "../../auth/auth-context";

const links = [
  { label: "Projects", path: "/projects" },
  { label: "Team", path: "/team" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">A</div>
        <span>AgiliX</span>
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section">WORKSPACE</p>

        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="avatar">{initialOf(user.name)}</div>
        <div className="sidebar-user">
          <strong title={user.email}>{user.name}</strong>
          <span>{user.role}</span>
        </div>
        <button type="button" className="sidebar-logout" onClick={logout}>
          Log out
        </button>
      </div>
    </aside>
  );
}