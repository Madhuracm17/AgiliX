import "./SprintDetails.css";

const LABELS: Record<string, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
};

/** Small coloured label: Planned (grey), Active (green), Completed (purple). */
export default function SprintStatusBadge({ status }: { status: string }) {
  const key = LABELS[status] ? status : "planned";
  return <span className={`sprint-status-badge sprint-status-${key}`}>{LABELS[key]}</span>;
}