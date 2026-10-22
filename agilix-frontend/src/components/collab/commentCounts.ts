import { getCommentCounts } from "../../api/comments";

/*
 * Comment counts for the board's cards. Every card asks for its own count, but
 * the requests made in the same moment are joined into ONE call to the server.
 */

type Listener = (count: number) => void;

const counts = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();
let pending = new Set<string>();
let timer: number | null = null;

function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  if (!ids.length) return;
  getCommentCounts(ids)
    .then((result) => {
      for (const id of ids) setCount(id, result[id] ?? 0);
    })
    .catch(() => undefined); // the counts are a nicety; the button still works without them
}

function setCount(taskId: string, count: number) {
  counts.set(taskId, count);
  listeners.get(taskId)?.forEach((listener) => listener(count));
}

/** Starts listening to a task's count (and asks the server for it). Returns "stop listening". */
export function watchCount(taskId: string, listener: Listener): () => void {
  if (!listeners.has(taskId)) listeners.set(taskId, new Set());
  listeners.get(taskId)!.add(listener);
  if (counts.has(taskId)) listener(counts.get(taskId)!);
  pending.add(taskId);
  if (timer === null) timer = window.setTimeout(flush, 30);
  return () => {
    listeners.get(taskId)?.delete(listener);
  };
}

/** After adding or deleting a comment. */
export function changeCount(taskId: string, by: number) {
  setCount(taskId, Math.max(0, (counts.get(taskId) ?? 0) + by));
}
