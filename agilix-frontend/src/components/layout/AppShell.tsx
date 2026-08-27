import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">AgiliX</span>
          </div>

          <div className="topbar-actions">
            <button className="icon-button">?</button>
            <div className="topbar-avatar">M</div>
          </div>
        </header>

        <section className="page-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}