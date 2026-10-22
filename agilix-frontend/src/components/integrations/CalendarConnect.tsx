import { useEffect, useState } from "react";
import {
  connectMyCalendar,
  disconnectMyCalendar,
  getMyCalendar,
  type MyCalendarStatus,
} from "../../api/calendar";
import "./calendar-connect.css";

/** Message for the ?calendar=... flag Google's redirect leaves on the address. */
const RETURN_MESSAGES: Record<string, string> = {
  connected: "Google Calendar connected.",
  cancelled: "Connecting was cancelled.",
  failed: "Could not connect Google Calendar. Please try again.",
};

/** Reads (once) and removes the ?calendar= flag, so a refresh does not show it again. */
function takeReturnFlag(): string {
  const params = new URLSearchParams(window.location.search);
  const flag = params.get("calendar");
  if (!flag) return "";
  params.delete("calendar");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  return RETURN_MESSAGES[flag] ?? "";
}

/**
 * "Google Calendar" row in the profile card. Connecting lets AgiliX read the
 * TIMES of your meetings (never titles or attendees) for sprint health and
 * burnout risk.
 */
export default function CalendarConnect() {
  const [status, setStatus] = useState<MyCalendarStatus | null>(null);
  const [message, setMessage] = useState(() => takeReturnFlag());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyCalendar()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status && !status.configured) return null; // not set up on this server: nothing to offer

  const connect = async () => {
    try {
      setBusy(true);
      setMessage("");
      await connectMyCalendar(); // leaves the page
    } catch (err) {
      setMessage(readMessage(err));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      setBusy(true);
      setMessage("");
      await disconnectMyCalendar();
      setStatus((s) => (s ? { ...s, connected: false, needsReconnect: false, googleEmail: null } : s));
      setMessage("Disconnected.");
    } catch (err) {
      setMessage(readMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const connected = !!status?.connected && !status.needsReconnect;

  return (
    <div className="calendar-connect">
      <span className="calendar-connect-label">Google Calendar</span>
      <div className="calendar-connect-row">
        <span className={`calendar-connect-state${connected ? " is-on" : ""}`}>
          {!status
            ? "…"
            : status.needsReconnect
              ? "Needs reconnecting"
              : connected
                ? status.googleEmail || "Connected"
                : "Not connected"}
        </span>
        {connected ? (
          <button type="button" onClick={disconnect} disabled={busy}>
            {busy ? "..." : "Disconnect"}
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={busy || !status}>
            {busy ? "..." : status?.needsReconnect ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
      <small>{message || "Meeting times only (no titles), for sprint health and burnout risk."}</small>
    </div>
  );
}

function readMessage(err: unknown): string {
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
