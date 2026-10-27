import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/auth-context";
import {
  addComment,
  COMMENT_MAX_LENGTH,
  deleteComment,
  getComments,
  type TaskComment,
} from "../../api/comments";
import { getTaskActivity, type ActivityEntry } from "../../api/activity";
import { timeAgo } from "../scrum/taskDisplay";
import { changeCount } from "./commentCounts";
import "./collab.css";

type Tab = "comments" | "history";

/** Events inside the panel must not reach the board card (drag-and-drop, card clicks). */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Side panel with a task's comments and its history (from the activity log).
 * Rendered on top of the page, so it works the same from the Scrum board, the
 * Kanban board and the Activity page.
 */
export default function TaskCommentsPanel({
  taskId,
  title,
  onClose,
}: {
  taskId: string;
  title: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("comments");
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [history, setHistory] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isAdmin = user.role === "admin";

  useEffect(() => {
    let cancelled = false;
    getComments(taskId)
      .then((list) => !cancelled && setComments(list))
      .catch((err) => !cancelled && setError(readMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (tab !== "history" || history) return;
    getTaskActivity(taskId)
      .then(setHistory)
      .catch((err) => setError(readMessage(err)));
  }, [tab, taskId, history]);

  // Escape closes; focus the text box when the panel opens.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Newest comment in view.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    try {
      setSending(true);
      setError("");
      const saved = await addComment(taskId, value);
      setComments((list) => [...(list ?? []), saved]);
      setHistory(null); // reload the history next time it is opened
      setText("");
      changeCount(taskId, 1);
    } catch (err) {
      setError(readMessage(err));
    } finally {
      setSending(false);
    }
  };

  const remove = async (comment: TaskComment) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await deleteComment(comment.id);
      setComments((list) => (list ?? []).filter((c) => c.id !== comment.id));
      changeCount(taskId, -1);
    } catch (err) {
      setError(readMessage(err));
    }
  };

  return createPortal(
    <div
      className="collab-scrim"
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
      onClick={(event) => {
        stop(event);
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="collab-panel" role="dialog" aria-modal="true" aria-label={`Comments on ${title}`}>
        <header className="collab-panel-head">
          <div>
            <span className="collab-eyebrow">Task</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="collab-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="collab-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "comments"}
            className={tab === "comments" ? "active" : ""}
            onClick={() => setTab("comments")}
          >
            Comments{comments ? ` (${comments.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>

        {error && <p className="collab-error">{error}</p>}

        {tab === "comments" ? (
          <>
            <div className="collab-list" ref={listRef}>
              {!comments && !error && <p className="collab-muted">Loading...</p>}
              {comments?.length === 0 && (
                <p className="collab-muted">No comments yet. Ask a question or share an update.</p>
              )}
              {comments?.map((comment) => (
                <article key={comment.id} className={`collab-comment${comment.author.id === user._id ? " mine" : ""}`}>
                  <div className="collab-comment-head">
                    <span className="collab-avatar">{comment.author.name.charAt(0).toUpperCase() || "?"}</span>
                    <strong>{comment.author.name}</strong>
                    {comment.author.role && <span className="collab-role">{comment.author.role}</span>}
                    <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
                      {timeAgo(comment.createdAt)}
                    </time>
                    {comment.canDelete && (
                      <button
                        type="button"
                        className="collab-delete"
                        onClick={() => remove(comment)}
                        aria-label="Delete comment"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p>{comment.text}</p>
                </article>
              ))}
            </div>

            {isAdmin ? (
              <p className="collab-muted collab-foot">Admins can read comments. The team writes them.</p>
            ) : (
              <form className="collab-form" onSubmit={send}>
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
                  }}
                  placeholder="Write a comment... (Ctrl + Enter to send)"
                  maxLength={COMMENT_MAX_LENGTH}
                  rows={3}
                />
                <div className="collab-form-row">
                  <small>
                    {text.length > COMMENT_MAX_LENGTH - 200 ? `${COMMENT_MAX_LENGTH - text.length} characters left` : ""}
                  </small>
                  <button type="submit" disabled={sending || !text.trim()}>
                    {sending ? "Sending..." : "Comment"}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          <div className="collab-list">
            {!history && !error && <p className="collab-muted">Loading...</p>}
            {history?.length === 0 && <p className="collab-muted">No recorded changes yet.</p>}
            <ol className="collab-timeline">
              {history?.map((entry) => (
                <li key={entry.id}>
                  <span>
                    <strong>{entry.actor.name || "Someone"}</strong> {entry.text}
                  </span>
                  <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                    {timeAgo(entry.at)}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/** The backend sends errors as JSON ({ message }); show just the message. */
export function readMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(" ");
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  return raw || "Something went wrong";
}
