import { useState } from "react";
import { getStandup, type StandupReport } from "../../api/insights";
import { readError } from "../scrum/taskDisplay";
import "./TeamHealthPanel.css";

/**
 * AI daily standup for the whole team: yesterday / today / blockers per person,
 * written by the AI from task moves in AgiliX and commit messages from GitHub.
 */
export default function StandupPanel({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<StandupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    try {
      setLoading(true);
      setError("");
      setReport(await getStandup(projectId, !!report));
    } catch (err) {
      setError(readError(err, "Could not write the standup"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="team-health" aria-label="AI daily standup">
      <article className="team-health-card">
        <div className="team-health-card-head">
          <div>
            <span className="eyebrow">AI DAILY STANDUP</span>
            <h3>{report ? `Since ${report.sinceLabel}` : "Yesterday · Today · Blockers"}</h3>
          </div>
          <button className="primary-button" onClick={run} disabled={loading}>
            {loading ? "Writing..." : report ? "Run again" : "Write standup"}
          </button>
        </div>

        {error && <p className="team-health-error">{error}</p>}
        {!report && !error && !loading && (
          <p className="team-health-empty">
            Written from what changed since the previous working day: tasks moved or finished in AgiliX and
            commits on GitHub.
          </p>
        )}

        {report && (
          <div className="team-health-result">
            <p className="team-health-summary">{report.headline}</p>
            <div className="standup-grid">
              {report.members.map((member) => (
                <div className="standup-person" key={member.userId}>
                  <strong>{member.name}</strong>
                  <h4>Yesterday</h4>
                  <ul>
                    {member.yesterday.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h4>Today</h4>
                  <ul>
                    {member.today.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {member.blockers.length > 0 && (
                    <>
                      <h4 className="standup-blockers">Blockers</h4>
                      <ul>
                        {member.blockers.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className="team-health-evidence">
                    <span>{member.facts.moved.length} task moves</span>
                    <span>{member.facts.finished.length} finished</span>
                    <span>{report.github === "ok" ? `${member.facts.commits.length} commits` : "GitHub: unknown"}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="team-health-sources">
              <span>
                Data: AgiliX tasks · GitHub {report.github === "ok" ? "commits" : "not available"} · written{" "}
                {new Date(report.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
