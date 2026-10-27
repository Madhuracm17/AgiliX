import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProjectActivity, type ActivityEntry } from "../../api/activity";
import { getTasks } from "../../api/tasks";
import { timeAgo } from "../scrum/taskDisplay";
import TaskCommentsPanel, { readMessage } from "./TaskCommentsPanel";
import "./collab.css";

const PAGE = 50;

const FILTERS: Array<{ key: string; label: string; match: (action: string) => boolean }> = [
  { key: "all", label: "Everything", match: () => true },
  { key: "tasks", label: "Tasks", match: (a) => a.startsWith("task.") },
  { key: "sprints", label: "Sprints", match: (a) => a.startsWith("sprint.") },
  { key: "comments", label: "Comments", match: (a) => a.startsWith("comment.") },
  { key: "team", label: "Team and approvals", match: (a) => a.startsWith("member.") || a.startsWith("approval.") },
];

/** "Today", "Yesterday" or a date, for grouping the feed by day. */
function dayLabel(date: string): string {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Project activity log: who did what, newest first. Clicking a task opens its comments and history. */
export default function ActivityPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [openTask, setOpenTask] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("task"),
  );

  const load = useCallback(
    async (before?: string) => {
      try {
        setLoading(true);
        setError("");
        const page = await getProjectActivity(projectId, before, PAGE);
        setEntries((current) => (before ? [...current, ...page] : page));
        setHasMore(page.length === PAGE);
      } catch (err) {
        setError(readMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    load();
    // Task titles, so entries can open the task's comments (deleted tasks stay plain text).
    getTasks(projectId)
      .then((tasks) => setTitles(Object.fromEntries(tasks.map((t) => [t._id, t.title]))))
      .catch(() => undefined);
  }, [load, projectId]);

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    return entries.filter((e) => match(e.action));
  }, [entries, filter]);

  const groups = useMemo(() => {
    const result: Array<{ day: string; items: ActivityEntry[] }> = [];
    for (const entry of visible) {
      const day = dayLabel(entry.at);
      const last = result[result.length - 1];
      if (last && last.day === day) last.items.push(entry);
      else result.push({ day, items: [entry] });
    }
    return result;
  }, [visible]);

  const closePanel = useCallback(() => {
    setOpenTask(null);
    const params = new URLSearchParams(window.location.search);
    if (params.has("task")) {
      params.delete("task");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow breadcrumb-link" onClick={() => navigate(`/projects/${projectId}`)}>
            ← Back to project
          </p>
          <h1>Activity</h1>
          <p className="page-description">Everything that happened in this project, newest first.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="collab-filters" role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={filter === f.key ? "active" : ""}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="collab-error">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Create, move or comment on a task and it will show up here.</p>
        </div>
      )}

      <div className="collab-feed">
        {groups.map((group) => (
          <section key={group.day}>
            <h3 className="collab-day">{group.day}</h3>
            <ol className="collab-timeline">
              {group.items.map((entry) => {
                const title = entry.taskId ? titles[entry.taskId] : undefined;
                return (
                  <li key={entry.id} className={`collab-entry action-${entry.action.split(".")[0]}`}>
                    <span className="collab-avatar">{entry.actor.name.charAt(0).toUpperCase() || "?"}</span>
                    <span className="collab-entry-text">
                      <strong>{entry.actor.name || "Someone"}</strong> {entry.text}
                      {entry.taskId && title !== undefined && (
                        <button type="button" className="collab-link" onClick={() => setOpenTask(entry.taskId)}>
                          Open
                        </button>
                      )}
                    </span>
                    <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                      {timeAgo(entry.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          className="secondary-button collab-more"
          disabled={loading}
          onClick={() => load(entries[entries.length - 1]?.at)}
        >
          {loading ? "Loading..." : "Show older"}
        </button>
      )}

      {openTask && <TaskCommentsPanel taskId={openTask} title={titles[openTask] ?? "Task"} onClose={closePanel} />}
    </div>
  );
}
