import { NavLink } from "react-router-dom";

const links = [
  { label: "Projects", path: "/projects" },
  { label: "Team", path: "/team" },
];

export default function Sidebar() {
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
        <div className="avatar">M</div>
        <div>
          <strong>AgiliX User</strong>
          <span>Workspace</span>
        </div>
      </div>
    </aside>
  );
}