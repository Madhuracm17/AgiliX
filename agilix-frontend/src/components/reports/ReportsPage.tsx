import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { getProject, type Project } from "../../api/projects";
import { getSprints, type Sprint } from "../../api/sprints";
import {
  getBurndown,
  getBurnout,
  getMyReport,
  getSprintReport,
  getVelocity,
  type BurnoutReport,
  type MyReport,
  type SprintReport,
  type SprintSeries,
  type VelocityReport,
} from "../../api/reports";
import { useAuth } from "../../auth/auth-context";
import SprintProgress from "../sprints/SprintProgress";
import { readError } from "../scrum/taskDisplay";
import { BurndownChart, BurnoutChart, formatHours, VelocityChart } from "./ReportCharts";
import "./reports.css";

type StatIconKind = "check" | "calendar" | "chart" | "person" | "clock" | "swap";

/** Small line icons shown in the corner of each summary tile. Decorative only. */
function StatIcon({ kind }: { kind: StatIconKind }) {
  const paths: Record<StatIconKind, ReactElement> = {
    check: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
        <path d="m9 15 2 2 4-4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19h16" />
        <path d="m5 16 4-5 3 3 6-8v10H5Z" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    swap: (
      <>
        <path d="M5 8h13l-3-3M19 16H6l3 3" />
      </>
    ),
  };
  return (
    <span className="stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind]}
      </svg>
    </span>
  );
}

interface Summary {
  totalTasks: number;
  doneTasks: number;
  completionRate: number;
  totalHours: number;
  // Added later: an older backend does not send these, so they may be missing.
  todoTasks?: number;
  inProgressTasks?: number;
  totalStoryPoints?: number;
  completedStoryPoints?: number;
  sprintPace?: "on_track" | "at_risk" | "behind" | null;
}

const PACE_LABEL = { on_track: "On track", at_risk: "At risk", behind: "Behind" } as const;

interface Workload {
  user: { _id: string; name: string; email: string };
  tasksTotal: number;
  tasksCompleted: number;
  tasksInProgress: number;
  hoursWorked: number;
  completionRate: number;
  storyPointsTotal?: number;
  storyPointsCompleted?: number;
}

const STATUS_LABEL: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

function formatTime(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return totalSeconds > 0 ? "<1m" : "0m";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Reports for one project. Managers and admins see the team reports;
 * everyone else sees their own work, sprint progress and time.
 */
export default function ReportsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeamView = user.role === "manager";

  const [project, setProject] = useState<Project | null>(null);
  // The view waits for the project to load, so the reports are fetched once
  // (not once before and once after we know whether it is Scrum).
  const [projectLoaded, setProjectLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setProjectLoaded(true));
  }, [projectId]);

  const isScrum = !!project && (project.methodology || "scrum") !== "kanban";
  // Only a project that has loaded as Kanban goes back to the Kanban board.
  const isKanban = !!project && project.methodology === "kanban";

  return (
    <div>
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate(`/projects/${projectId}/${isKanban ? "kanban" : "sprints"}`)}
          >
            ← {isKanban ? "Kanban Board" : "Scrum Board"}
          </p>
          <h1>Reports</h1>
          <p className="page-description">
            {user.role === "admin"
              ? "Reports are for managers, developers and testers."
              : isTeamView
                ? "Sprint progress, velocity and team workload for this project."
                : "Your tasks, sprint progress and tracked time on this project."}
          </p>
        </div>

        {isScrum && (
          <button
            className="secondary-button"
            onClick={() => navigate(`/projects/${projectId}/ai-insights`)}
          >
            AI Insights
          </button>
        )}
      </div>

      {user.role === "admin" && (
        <div className="empty-state">
          <h2>Reports are not available for admins</h2>
          <p>Reports are shown to managers, developers and testers.</p>
        </div>
      )}

      {projectId &&
        projectLoaded &&
        user.role !== "admin" &&
        (isTeamView ? (
          <TeamReports projectId={projectId} isScrum={isScrum} />
        ) : (
          <MyReports projectId={projectId} isTester={user.role === "tester"} />
        ))}
    </div>
  );
}

/* ---------------------------- manager / admin ---------------------------- */

function TeamReports({ projectId, isScrum }: { projectId: string; isScrum: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [velocity, setVelocity] = useState<VelocityReport | null>(null);
  const [sprintId, setSprintId] = useState("");
  const [series, setSeries] = useState<SprintSeries | null>(null);
  const [report, setReport] = useState<SprintReport | null>(null);
  const [burnout, setBurnout] = useState<BurnoutReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sprintLoading, setSprintLoading] = useState(false);
  const [sprintsReady, setSprintsReady] = useState(false);
  const [error, setError] = useState("");

  // Totals and workload. Shown as soon as they arrive.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Summary>(`/analytics/summary/${projectId}`),
      api<Workload[]>(`/analytics/workload/${projectId}`),
    ])
      .then(([summaryData, workloadData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setWorkload(workloadData);
      })
      .catch((err) => !cancelled && setError(readError(err, "Failed to load reports")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Sprints and velocity are requested together, at the same time as the totals.
  useEffect(() => {
    if (!isScrum) return;
    let cancelled = false;
    Promise.all([getSprints(projectId), getVelocity(projectId)])
      .then(([sprintData, velocityData]) => {
        if (cancelled) return;
        setSprints(sprintData);
        setVelocity(velocityData);

        // Open the active sprint, otherwise the most recently completed one.
        const pick =
          sprintData.find((s) => s.status === "active") ??
          [...sprintData]
            .filter((s) => s.status === "completed")
            .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0] ??
          sprintData[0];
        setSprintId(pick?._id ?? "");
      })
      .catch((err) => !cancelled && setError(readError(err, "Failed to load reports")))
      .finally(() => !cancelled && setSprintsReady(true));
    return () => {
      cancelled = true;
    };
  }, [projectId, isScrum]);

  useEffect(() => {
    if (!isScrum || !sprintId) {
      setSeries(null);
      setReport(null);
      setBurnout(null);
      return;
    }
    let cancelled = false;
    setSprintLoading(true);
    Promise.all([getBurndown(sprintId), getSprintReport(sprintId), getBurnout(sprintId)])
      .then(([seriesData, reportData, burnoutData]) => {
        if (cancelled) return;
        setSeries(seriesData);
        setReport(reportData);
        setBurnout(burnoutData);
      })
      .catch((err) => !cancelled && setError(readError(err, "Failed to load the sprint report")))
      .finally(() => !cancelled && setSprintLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sprintId, isScrum]);

  const sprintOptions = useMemo(
    () => [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [sprints],
  );

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading reports...</h2>
      </div>
    );
  }
  if (error) {
    return (
      <div className="empty-state">
        <h2>Unable to load reports</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      {summary && (
        <div className="project-info-card">
          <div>
            <StatIcon kind="calendar" />
            <span className="eyebrow">TOTAL TASKS</span>
            <h3>{summary.totalTasks}</h3>
          </div>
          <div>
            <StatIcon kind="check" />
            <span className="eyebrow">COMPLETED</span>
            <h3>{summary.doneTasks}</h3>
          </div>
          <div>
            <StatIcon kind="chart" />
            <span className="eyebrow">COMPLETION RATE</span>
            <h3>{summary.completionRate}%</h3>
          </div>
          <div>
            <StatIcon kind="person" />
            <span className="eyebrow">HOURS TRACKED</span>
            <h3>{summary.totalHours}h</h3>
          </div>
        </div>
      )}

      {summary && summary.todoTasks !== undefined && (
        <div className="project-info-card">
          <div>
            <StatIcon kind="calendar" />
            <span className="eyebrow">TO DO</span>
            <h3>{summary.todoTasks}</h3>
          </div>
          <div>
            <StatIcon kind="clock" />
            <span className="eyebrow">IN PROGRESS</span>
            <h3>{summary.inProgressTasks ?? 0}</h3>
            <p>including Review</p>
          </div>
          <div>
            <StatIcon kind="chart" />
            <span className="eyebrow">STORY POINTS</span>
            <h3>
              {summary.completedStoryPoints ?? 0}/{summary.totalStoryPoints ?? 0}
            </h3>
            <p>done / total</p>
          </div>
          <div>
            <StatIcon kind="person" />
            <span className="eyebrow">SPRINT PACE</span>
            <h3>{summary.sprintPace ? PACE_LABEL[summary.sprintPace] : "No active sprint"}</h3>
            <p>finished work vs time passed</p>
          </div>
        </div>
      )}

      {isScrum && (
        <>
          {!sprintsReady ? (
            <section className="rpt-section">
              <p className="rpt-empty">Loading sprint reports...</p>
            </section>
          ) : sprintOptions.length === 0 ? (
            <section className="rpt-section">
              <h2>Sprint reports</h2>
              <p className="rpt-empty">
                Create and start a sprint to see its burndown, burnout and sprint report.
              </p>
            </section>
          ) : (
            <>
              <section className="rpt-section">
                <div className="rpt-section-head">
                  <div>
                    <h2>Sprint report</h2>
                    {report?.sprint.goal && <p className="rpt-sub">Goal: {report.sprint.goal}</p>}
                  </div>
                  <select
                    className="rpt-select"
                    aria-label="Choose a sprint"
                    value={sprintId}
                    onChange={(e) => setSprintId(e.target.value)}
                  >
                    {sprintOptions.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name} ({s.status})
                      </option>
                    ))}
                  </select>
                </div>

                {sprintLoading && <p className="rpt-empty">Loading sprint...</p>}

                {report && !sprintLoading && (
                  <>
                    <div className="project-info-card" style={{ marginBottom: 16 }}>
                      <div>
                        <StatIcon kind="calendar" />
                        <span className="eyebrow">COMMITTED</span>
                        <h3>{report.committedPoints} pts</h3>
                      </div>
                      <div>
                        <StatIcon kind="check" />
                        <span className="eyebrow">COMPLETED</span>
                        <h3>{report.completedPoints} pts</h3>
                      </div>
                      <div>
                        <StatIcon kind="chart" />
                        <span className="eyebrow">TOTAL SCOPE</span>
                        <h3>{report.totalScopePoints} pts</h3>
                      </div>
                      <div>
                        <StatIcon kind="swap" />
                        <span className="eyebrow">SCOPE CHANGES</span>
                        <h3>{report.scopeChanges.length}</h3>
                      </div>
                    </div>

                    <div className="rpt-two">
                      <div>
                        <h3>Completed ({report.completedTasks.length})</h3>
                        {report.completedTasks.length === 0 ? (
                          <p className="rpt-empty">No tasks completed yet.</p>
                        ) : (
                          <ul className="rpt-list">
                            {report.completedTasks.map((t) => (
                              <li key={t.id}>
                                {t.title}
                                <span>{t.points} pts</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h3>
                          {report.sprint.status === "completed" ? "Carried over" : "Not done yet"} (
                          {report.incompleteTasks.length})
                        </h3>
                        {report.incompleteTasks.length === 0 ? (
                          <p className="rpt-empty">Nothing left over.</p>
                        ) : (
                          <ul className="rpt-list">
                            {report.incompleteTasks.map((t) => (
                              <li key={t.id}>
                                {t.title}
                                <span>
                                  {STATUS_LABEL[t.status] ?? t.status} · {t.points} pts
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {report.scopeChanges.length > 0 && (
                      <>
                        <h3 style={{ marginTop: 18 }}>Added after the sprint started</h3>
                        <ul className="rpt-list">
                          {report.scopeChanges.map((c, i) => (
                            <li key={`${c.title}-${i}`}>
                              {c.title}
                              <span>
                                +{c.points} pts
                                {c.addedAt ? ` · ${new Date(c.addedAt).toLocaleDateString()}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </section>

              {series && !sprintLoading && (
                <div className="rpt-two" style={{ marginBottom: 24 }}>
                  <section className="rpt-section">
                    <h2>Burndown</h2>
                    <p className="rpt-sub">Story points still to do, against the ideal pace.</p>
                    <BurndownChart days={series.days} />
                  </section>
                  <section className="rpt-section">
                    <h2>Burnout</h2>
                    <p className="rpt-sub">
                      Hours tracked per person this sprint, against a {burnout ? formatHours(burnout.limitHours) : "40h"} limit.
                    </p>
                    {burnout && burnout.people.length > 0 ? (
                      <>
                        <BurnoutChart report={burnout} />
                        {burnout.people.filter((p) => p.note).length > 0 && (
                          <ul className="rpt-flags">
                            {burnout.people
                              .filter((p) => p.note)
                              .map((p) => (
                                <li key={p.userId} className={`rpt-flag rpt-flag-${p.level}`}>
                                  <strong>{p.name}:</strong> {p.note}
                                </li>
                              ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p className="rpt-empty">
                        No time has been tracked on this sprint yet. Hours appear here once the team starts the task timer.
                      </p>
                    )}
                  </section>
                </div>
              )}
            </>
          )}

          <section className="rpt-section">
            <div className="rpt-section-head">
              <div>
                <h2>Velocity</h2>
                <p className="rpt-sub">
                  Committed against completed points for finished sprints
                  {velocity && velocity.sprints.length > 0
                    ? `. Average of the last three: ${velocity.averageVelocity} pts.`
                    : "."}
                </p>
              </div>
            </div>
            {velocity && velocity.sprints.length > 0 ? (
              <VelocityChart sprints={velocity.sprints} average={velocity.averageVelocity} />
            ) : (
              <p className="rpt-empty">Complete a sprint to start building velocity.</p>
            )}
          </section>
        </>
      )}

      <section className="rpt-section">
        <h2>Team workload</h2>
        {workload.length === 0 ? (
          <p className="rpt-empty">Add members to the project to see workload here.</p>
        ) : (
          <div className="workload-list" style={{ marginTop: 12 }}>
            {workload.filter((w) => w.user && w.user.name).map((w) => (
              <div className="workload-card" key={w.user._id}>
                <div className="team-avatar">{w.user.name.charAt(0).toUpperCase()}</div>

                <div className="workload-info">
                  <h2>{w.user.name}</h2>

                  <div className="workload-stats">
                    <span>{w.tasksTotal} tasks</span>
                    <span>{w.tasksInProgress} in progress</span>
                    <span>{w.tasksCompleted} completed</span>
                    <span>{w.hoursWorked}h tracked</span>
                    {w.storyPointsTotal !== undefined && (
                      <span>
                        {w.storyPointsCompleted ?? 0}/{w.storyPointsTotal} points
                      </span>
                    )}
                  </div>

                  <div className="workload-bar">
                    <div className="workload-bar-fill" style={{ width: `${w.completionRate}%` }} />
                  </div>
                </div>

                <div className="workload-rate">{w.completionRate}%</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------------------- developer / tester ---------------------------- */

function MyReports({ projectId, isTester }: { projectId: string; isTester: boolean }) {
  const [report, setReport] = useState<MyReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getMyReport(projectId)
      .then((data) => !cancelled && setReport(data))
      .catch((err) => !cancelled && setError(readError(err, "Failed to load your report")));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="empty-state">
        <h2>Unable to load your report</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="empty-state">
        <h2>Loading your report...</h2>
      </div>
    );
  }

  const { progress, totals, activeSprint } = report;

  return (
    <>
      <div className="project-info-card">
        <div>
          <StatIcon kind="person" />
          <span className="eyebrow">MY TASKS</span>
          <h3>{totals.tasks}</h3>
          {isTester && <p>assigned to me + to review</p>}
        </div>
        <div>
          <StatIcon kind="chart" />
          <span className="eyebrow">{isTester ? "TO REVIEW / IN PROGRESS" : "IN PROGRESS"}</span>
          <h3>{totals.inProgress}</h3>
        </div>
        <div>
          <StatIcon kind="check" />
          <span className="eyebrow">COMPLETED</span>
          <h3>{totals.done}</h3>
          {isTester && <p>incl. tasks I approved or sent back</p>}
        </div>
        <div>
          <StatIcon kind="clock" />
          <span className="eyebrow">TIME TRACKED</span>
          <h3 className="rpt-time">{formatTime(report.time.totalSeconds)}</h3>
        </div>
      </div>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <div>
            <h2>My sprint progress</h2>
            {activeSprint && (
              <p className="rpt-sub">
                {activeSprint.name}
                {activeSprint.goal ? ` · Goal: ${activeSprint.goal}` : ""}
              </p>
            )}
          </div>
        </div>

        {!activeSprint ? (
          <p className="rpt-empty">There is no active sprint right now.</p>
        ) : progress.assignedTasks === 0 ? (
          <p className="rpt-empty">You have no tasks in the active sprint.</p>
        ) : (
          <SprintProgress
            totalTasks={progress.assignedTasks}
            doneTasks={progress.doneTasks}
            inProgressTasks={0}
            totalStoryPoints={progress.assignedPoints}
            completedStoryPoints={progress.donePoints}
            inProgressStoryPoints={0}
          />
        )}
      </section>

      <section className="rpt-section">
        <h2>{isTester ? "My tasks and reviews" : "My tasks"}</h2>
        {report.tasks.length === 0 ? (
          <p className="rpt-empty">
            {isTester
              ? "Nothing here yet. Tasks you are assigned, and tasks waiting for your review, appear here."
              : "No tasks are assigned to you yet."}
          </p>
        ) : (
          <table className="rpt-velocity-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Points</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {report.tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.title}
                    {isTester && t.kind === "review" && (
                      <span className="rpt-task-kind"> · waiting for my review</span>
                    )}
                    {isTester && t.kind === "reviewed" && (
                      <span className="rpt-task-kind"> · reviewed by me</span>
                    )}
                  </td>
                  <td>{STATUS_LABEL[t.status] ?? t.status}</td>
                  <td>{t.points}</td>
                  <td>{formatTime(t.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
