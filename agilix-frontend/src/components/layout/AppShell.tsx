import { Link, Outlet } from "react-router-dom";
import ProfileMenu from "./ProfileMenu";
import NotificationBell from "../notifications/NotificationBell";
import "./shell.css";

/**
 * Every page uses the Figma layout: no sidebar, just a top bar with the logo
 * (back to the Dashboard), the bell and the profile menu.
 */
export default function AppShell() {
  return (
    <div className="app-shell app-shell-bare">
      <main className="main-content">
        <header className="topbar topbar-dashboard">
          <Link to="/dashboard" className="topbar-logo" aria-label="Dashboard">
            <span className="logo-mark">A</span>
          </Link>

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
