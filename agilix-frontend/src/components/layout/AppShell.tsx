import { useCallback, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import ProfileMenu from "./ProfileMenu";
import SideMenu from "./SideMenu";
import NotificationBell from "../notifications/NotificationBell";
import "./shell.css";

/**
 * Every page uses the Figma layout: a top bar with the menu button (three lines,
 * opens the sliding menu), the logo (back to the Dashboard), the bell and the
 * profile menu.
 */
export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="app-shell app-shell-bare">
      <SideMenu open={menuOpen} onClose={closeMenu} />

      <main className="main-content">
        <header className="topbar topbar-dashboard">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="side-menu"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <Link to="/dashboard" className="topbar-logo" aria-label="Dashboard">
              <span className="logo-mark">A</span>
            </Link>
          </div>

          <div className="topbar-actions">
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        <section className="page-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
