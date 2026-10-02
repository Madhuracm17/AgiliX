import { useEffect, useState } from "react";
import { getTasks } from "../../api/tasks";
import { getSprints } from "../../api/sprints";
import { initialOf } from "../../auth/auth-context";
import "./project-card.css";

interface Person {
  _id: string;
  name: string;
}

interface ProjectCardProps {
  project: {
    _id: string;
    name: string;
    description?: string;
    owner?: Person;
    members?: Person[];
    methodology?: "scrum" | "kanban";
  };
  onOpen: () => void;
}

interface Stats {
  active: boolean;
  /** Scrum: position of the current sprint, and how many sprints there are. */
  sprintNumber: number;
  sprintTotal: number;
  /** Kanban: share of tasks that are done. */
  completionRate: number;
}

const MAX_AVATARS = 3;

/**
 * Project card for the All Projects page (Figma frame 2): name, status,
 * methodology, short summary, a sprint progress bar (Scrum) or completion
 * rate (Kanban), and the people on the team.
 */
export default function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const isKanban = project.methodology === "kanban";
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [tasks, sprints] = await Promise.all([
          getTasks(project._id),
          getSprints(project._id),
        ]);
        if (cancelled) return;

        const ordered = [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate));
        const activeIndex = ordered.findIndex((s) => s.status === "active");
        const finished = ordered.filter((s) => s.status === "completed").length;
        const done = tasks.filter((t) => t.status === "done").length;

        setStats({
          active: isKanban ? tasks.length > 0 : activeIndex >= 0,
          // Counts the running sprint, or the finished ones when none is running.
          sprintNumber: activeIndex >= 0 ? activeIndex + 1 : finished,
          sprintTotal: ordered.length,
          completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [project._id, isKanban]);

  // Owner first, then members, without listing anyone twice.
  const people: Person[] = [];
  for (const person of [project.owner, ...(project.members ?? [])]) {
    if (person && typeof person === "object" && !people.some((p) => p._id === person._id)) {
      people.push(person);
    }
  }
  const shown = people.slice(0, MAX_AVATARS);
  const extra = people.length - shown.length;

  const percent = isKanban
    ? (stats?.completionRate ?? 0)
    : stats && stats.sprintTotal > 0
      ? Math.round((stats.sprintNumber / stats.sprintTotal) * 100)
      : 0;

  return (
    <div className="project-card pcard" onClick={onOpen}>
      <div className="pcard-top">
        <h2>{project.name}</h2>
        <span className={`pcard-status ${stats?.active ? "pcard-status-active" : ""}`}>
          {stats?.active ? "Active" : "Pending"}
        </span>
      </div>

      <p className="pcard-method">{isKanban ? "Kanban" : "Scrum"}</p>

      <p className="pcard-summary">
        {project.description || "No project description available."}
      </p>

      <div className="pcard-progress">
        <div className="pcard-progress-label">
          <span>
            {isKanban
              ? "Completion rate"
              : stats && stats.sprintTotal > 0
                ? "Sprint"
                : "No sprints yet"}
          </span>
          <strong>
            {isKanban
              ? `${percent}%`
              : stats && stats.sprintTotal > 0
                ? `${stats.sprintNumber}/${stats.sprintTotal}`
                : ""}
          </strong>
        </div>
        <div className="pcard-bar" aria-hidden="true">
          <div className="pcard-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="pcard-people" aria-label="Team">
        {shown.map((person) => (
          <span key={person._id} className="pcard-avatar" title={person.name}>
            {initialOf(person.name)}
          </span>
        ))}
        {extra > 0 && <span className="pcard-more">+{extra}</span>}
      </div>
    </div>
  );
}
