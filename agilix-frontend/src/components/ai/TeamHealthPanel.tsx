import { useState } from "react";
import {
  getBurnoutRisk,
  getSprintHealth,
  type BurnoutRiskReport,
  type InsightSources,
  type MemberBurnoutRisk,
  type SprintHealthReport,
} from "../../api/insights";
import { readError } from "../scrum/taskDisplay";
import "./TeamHealthPanel.css";

const HEALTH_LABEL: Record<SprintHealthReport["status"], string> = {
  healthy: "Healthy",
  at_risk: "At risk",
  critical: "Critical",
};

const SOURCE_LABEL: Record<string, string> = {
  ok: "connected",
  not_linked: "no repo linked",
  not_configured: "not set up",
  error: "unreachable",
  not_connected: "not connected yet",
};

/**
 * AI team health for managers: sprint / flow health and burnout risk per
 * person. The backend gathers AgiliX and GitHub (MCP) data, the LLM analyses
 * it, and the measured numbers are shown next to each verdict as evidence.
 */
export default function TeamHealthPanel({ projectId }: { projectId: string }) {
  const [health, setHealth] = useState<SprintHealthReport | null>(null);
  const [burnout, setBurnout] = useState<BurnoutRiskReport | null>(null);
  const [days, setDays] = useState(14);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingBurnout, setLoadingBurnout] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [burnoutError, setBurnoutError] = useState("");

  const runHealth = async (refresh: boolean) => {
    try {
      setLoadingHealth(true);
      setHealthError("");
      setHealth(await getSprintHealth(projectId, refresh));
    } catch (err) {
      setHealthError(readError(err, "Could not analyse sprint health"));
    } finally {
      setLoadingHealth(false);
    }
  };

  const runBurnout = async (refresh: boolean) => {
    try {
      setLoadingBurnout(true);
      setBurnoutError("");
      setBurnout(await getBurnoutRisk(projectId, days, refresh));
    } catch (err) {
      setBurnoutError(readError(err, "Could not analyse burnout risk"));
    } finally {
      setLoadingBurnout(false);
    }
  };

  return (
    <section className="team-health" aria-label="AI team health">
      <header className="team-health-head">
        <div>
          <span className="eyebrow">AI TEAM HEALTH</span>
          <h2>Sprint health and burnout risk</h2>
          <p>
            AgiliX collects tasks, tracked time and GitHub activity (through the GitHub MCP server), and the AI
            analyses it. Each run takes up to about 30 seconds.
          </p>
        </div>
      </header>

      <div className="team-health-grid">
        {/* ---------------- Sprint / flow health ---------------- */}
        <article className="team-health-card">
          <div className="team-health-card-head">
            <h3>{health?.facts.mode === "flow" ? "Flow health" : "Sprint health"}</h3>
            <button
              className="primary-button"
              onClick={() => runHealth(!!health)}
              disabled={loadingHealth}
            >
              {loadingHealth ? "Analysing..." : health ? "Run again" : "Analyse"}
            </button>
          </div>

          {healthError && <p className="team-health-error">{healthError}</p>}
          {!health && !healthError && !loadingHealth && (
            <p className="team-health-empty">
              Judges the active sprint, or the board's flow for Kanban projects.
            </p>
          )}

          {health && (
            <div className={`team-health-result health-${health.status}`}>
              <div className="team-health-verdict">
                <span className={`team-health-badge badge-${health.status}`}>{HEALTH_LABEL[health.status]}</span>
                <ScoreBar score={health.score} label="Health score" />
              </div>
              {health.completionForecastPercent !== null && (
                <p className="team-health-forecast">
                  Forecast: <strong>{health.completionForecastPercent}%</strong> of the sprint's work done by the end date
                </p>
              )}
              <p className="team-health-summary">{health.summary}</p>
              {health.risks.length > 0 && (
                <>
                  <h4>Risks</h4>
                  <ul>
                    {health.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Recommendations</h4>
              <ul>
                {health.recommendations.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <HealthFacts report={health} />
              <Sources sources={health.sources} generatedAt={health.generatedAt} />
            </div>
          )}
        </article>

        {/* ---------------- Burnout risk ---------------- */}
        <article className="team-health-card">
          <div className="team-health-card-head">
            <h3>Burnout risk</h3>
            <div className="team-health-controls">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label="Period"
                disabled={loadingBurnout}
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
              <button
                className="primary-button"
                onClick={() => runBurnout(!!burnout && burnout.windowDays === days)}
                disabled={loadingBurnout}
              >
                {loadingBurnout ? "Analysing..." : burnout ? "Run again" : "Analyse"}
              </button>
            </div>
          </div>

          {burnoutError && <p className="team-health-error">{burnoutError}</p>}
          {!burnout && !burnoutError && !loadingBurnout && (
            <p className="team-health-empty">
              Looks for long hours, late-night and weekend work, no rest days and overload, per person.
            </p>
          )}

          {burnout && (
            <div className="team-health-result">
              <p className="team-health-summary">{burnout.teamSummary}</p>
              {burnout.members.map((member) => (
                <MemberRow key={member.userId} member={member} />
              ))}
              <Sources sources={burnout.sources} generatedAt={burnout.generatedAt} notes={burnout.notes} />
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <div className="team-health-score" title={`${label}: ${score} / 100`}>
      <div className="team-health-score-track">
        <div className="team-health-score-fill" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span>{score}</span>
    </div>
  );
}

function MemberRow({ member }: { member: MemberBurnoutRisk }) {
  const [open, setOpen] = useState(member.risk !== "low");
  const s = member.signals;
  const evidence = [
    `${s.work.hoursTracked} h tracked`,
    `${s.work.lateNightHours} h late night`,
    `${s.work.weekendHours} h weekend`,
    `longest day ${s.work.longestDayHours} h`,
    `${s.work.longestStreakDays} days in a row`,
    `${s.tasks.open} open tasks (${s.tasks.inProgress} in progress)`,
    ...(s.github
      ? [`${s.github.commits} commits (${s.github.lateNightCommits} late night)`, `${s.github.reviewsGiven} reviews`]
      : ["GitHub: unknown"]),
  ];

  return (
    <div className={`team-health-member member-${member.risk}`}>
      <button type="button" className="team-health-member-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="team-health-member-name">{member.name}</span>
        <span className={`team-health-badge badge-${member.risk}`}>{member.risk}</span>
        <span className="team-health-member-score">{member.score}</span>
      </button>
      {open && (
        <div className="team-health-member-body">
          <ul>
            {member.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <h4>What to do</h4>
          <ul>
            {member.recommendations.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <div className="team-health-evidence">
            {evidence.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthFacts({ report }: { report: SprintHealthReport }) {
  const f = report.facts;
  const items: string[] = [];
  if (f.sprint) {
    items.push(
      `${f.sprint.elapsedPercent}% of time used`,
      `${f.sprint.remainingDays} days left`,
      f.sprint.storyPoints.total > 0
        ? `${f.sprint.storyPoints.done}/${f.sprint.storyPoints.total} points done`
        : `${f.sprint.tasks.done}/${f.sprint.tasks.total} tasks done`,
    );
  }
  if (f.flow) {
    items.push(
      `WIP ${f.flow.wip}${f.flow.wipLimit > 0 ? ` / limit ${f.flow.wipLimit}` : ""}`,
      `throughput ${f.flow.throughputThisPeriod} (before: ${f.flow.throughputPreviousPeriod})`,
      f.flow.medianCycleDays !== null ? `cycle time ${f.flow.medianCycleDays} days` : "cycle time n/a",
    );
  }
  items.push(`${f.ageingInProgress} stuck in progress`);
  if (f.github) {
    items.push(`${f.github.commits} commits`, `${f.github.prsMerged} PRs merged`, `${f.github.reviews} reviews`);
  }
  return (
    <div className="team-health-evidence">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function Sources({ sources, generatedAt, notes = [] }: { sources: InsightSources; generatedAt: string; notes?: string[] }) {
  return (
    <div className="team-health-sources">
      <span>
        Data: AgiliX · GitHub {SOURCE_LABEL[sources.github] ?? sources.github} · Calendar{" "}
        {SOURCE_LABEL[sources.calendar] ?? sources.calendar} · analysed{" "}
        {new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      {notes
        .filter((note) => !note.startsWith("Google Calendar"))
        .map((note) => (
          <span key={note}>{note}</span>
        ))}
    </div>
  );
}
