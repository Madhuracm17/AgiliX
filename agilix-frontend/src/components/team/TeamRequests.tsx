import { useCallback, useEffect, useState } from "react";
import {
  acceptInvite,
  declineInvite,
  getMyInvites,
  type MyInvite,
} from "../../api/teamInvites";
import { readError } from "../scrum/taskDisplay";
import "./team.css";

/**
 * Team requests waiting for the logged-in person (a manager asked them to join a
 * project), shown as a popup with Accept, Decline and Later. Renders nothing
 * when there are none. `onChanged` runs after an answer so the page can reload.
 */
export default function TeamRequests({ onChanged }: { onChanged?: () => void }) {
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // "Later" hides the popup until the page is opened again.
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvites(await getMyInvites());
    } catch {
      // The dashboard still works without this card.
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (invite: MyInvite, accept: boolean) => {
    if (busyId) return;
    try {
      setBusyId(invite._id);
      setError("");
      if (accept) await acceptInvite(invite._id);
      else await declineInvite(invite._id);
      const project = invite.project?.name ?? "the project";
      setNotice(accept ? `You joined ${project}.` : `You declined the request to join ${project}.`);
      await load();
      onChanged?.();
    } catch (err) {
      setError(readError(err, "Could not answer the request"));
    } finally {
      setBusyId(null);
    }
  };

  if (hidden || (invites.length === 0 && !notice)) return null;

  return (
    <div className="team-popup-backdrop">
      <section className="team-popup" role="dialog" aria-modal="true" aria-label="Team requests">
        <h2>{invites.length > 0 ? "You have a team request" : "Team requests"}</h2>
        {invites.length > 0 && (
          <p className="team-popup-sub">Accept to join the project, or decline.</p>
        )}

        {notice && <p className="team-requests-notice">{notice}</p>}
        {error && (
          <p className="member-error" role="alert">
            {error}
          </p>
        )}

        {invites.map((invite) => (
          <div className="team-request-row" key={invite._id}>
            <div className="team-request-info">
              <strong>{invite.project?.name ?? "A project"}</strong>
              <span>
                {invite.invitedBy?.name ?? "A manager"} asked you to join their team
              </span>
            </div>
            <div className="team-request-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busyId !== null}
                onClick={() => answer(invite, true)}
              >
                Accept
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busyId !== null}
                onClick={() => answer(invite, false)}
              >
                Decline
              </button>
            </div>
          </div>
        ))}

        <div className="team-popup-footer">
          <button type="button" className="secondary-button" onClick={() => setHidden(true)}>
            {invites.length > 0 ? "Later" : "Close"}
          </button>
        </div>
      </section>
    </div>
  );
}
