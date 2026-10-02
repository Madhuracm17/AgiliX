import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { getProjects } from "../../api/projects";
import { getTasks } from "../../api/tasks";
import { getSprints } from "../../api/sprints";
import { timeAgo } from "../scrum/taskDisplay";
import {
  buildNotifications,
  type AppNotification,
  type ProjectData,
} from "./buildNotifications";
import "./notifications.css";

/** How often the bell looks for news while the app is open. */
const REFRESH_MS = 60_000;
/** Remember at most this many seen notifications. */
const MAX_REMEMBERED = 300;

function readSeen(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(storageKey: string, seen: Set<string>) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify([...seen].slice(-MAX_REMEMBERED))
    );
  } catch {
    // Storage can be blocked; the bell then simply shows everything as new.
  }
}

/**
 * Bell icon in the top bar. Shows a red dot while there is something new,
 * and a list of notifications when clicked.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const storageKey = `agilix.notifications.seen.${user._id}`;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen(storageKey));
  const [open, setOpen] = useState(false);
  // What was new at the moment the panel was opened, so it can stay highlighted.
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const projects = await getProjects();
      const data: ProjectData[] = await Promise.all(
        projects.map(async (project) => {
          // One failing project should not hide the others.
          const [tasks, sprints] = await Promise.all([
            getTasks(project._id).catch(() => []),
            getSprints(project._id).catch(() => []),
          ]);
          return { project, tasks, sprints };
        })
      );
      setItems(buildNotifications(user, data));
    } catch {
      // The bell is optional; if loading fails it just stays as it was.
    }
  }, [user]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasUnread = items.some((item) => !seen.has(item.key));

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }

    // Opening the list counts as reading everything in it.
    setNewKeys(new Set(items.filter((i) => !seen.has(i.key)).map((i) => i.key)));
    const nextSeen = new Set(seen);
    items.forEach((i) => nextSeen.add(i.key));
    setSeen(nextSeen);
    writeSeen(storageKey, nextSeen);
    setOpen(true);
    load();
  };

  const go = (item: AppNotification) => {
    setOpen(false);
    navigate(item.link);
  };

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="icon-button bell-button"
        aria-label={hasUnread ? "Notifications (new)" : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {hasUnread && <span className="bell-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="bell-panel">
          <p className="bell-title">Notifications</p>

          {items.length === 0 ? (
            <p className="bell-empty">You are all caught up.</p>
          ) : (
            <ul className="bell-list">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`bell-item ${newKeys.has(item.key) ? "bell-item-new" : ""}`}
                    onClick={() => go(item)}
                  >
                    <span className="bell-item-text">{item.text}</span>
                    <span className="bell-item-meta">
                      {item.detail}
                      {item.at ? ` · ${timeAgo(item.at)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
