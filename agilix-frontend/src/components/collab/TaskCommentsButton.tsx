import { useEffect, useState, type SyntheticEvent } from "react";
import TaskCommentsPanel from "./TaskCommentsPanel";
import { watchCount } from "./commentCounts";
import "./collab.css";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Was this card's panel asked for in the address (?comments=<taskId>, e.g. from a notification)? */
function askedFor(taskId: string): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("comments") !== taskId) return false;
  params.delete("comments");
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  return true;
}

/**
 * "Comments" button on a board card, with the number of comments. Clicking it
 * opens the task's comments and history. It never starts a drag.
 */
export default function TaskCommentsButton({ taskId, title }: { taskId: string; title: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(() => askedFor(taskId));

  useEffect(() => watchCount(taskId, setCount), [taskId]);

  return (
    <>
      <button
        type="button"
        className={`collab-card-button${count ? " has-comments" : ""}`}
        onMouseDown={stop}
        onPointerDown={stop}
        onTouchStart={stop}
        onKeyDown={stop}
        onClick={(event) => {
          stop(event);
          setOpen(true);
        }}
        aria-label={`Comments on ${title}${count ? ` (${count})` : ""}`}
        title="Comments and history"
      >
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path
            d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span>{count ? count : "Comment"}</span>
      </button>
      {open && <TaskCommentsPanel taskId={taskId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
