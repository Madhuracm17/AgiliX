import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import {
  approveRequest,
  getApprovals,
  rejectRequest,
  type ApprovalRequest,
} from "../../api/approvals";
import { canEditTaskPlan, readError, timeAgo } from "../scrum/taskDisplay";
import "./approvals.css";

const STATUS_LABEL: Record<ApprovalRequest["status"], string> = {
  pending: "Waiting for a manager",
  approved: "Approved",
  rejected: "Not approved",
};

/**
 * Requests to create or delete a task. Developers and testers must ask a manager
 * first; managers and admins see every request on the project and decide them.
 * Everyone else sees only their own requests and what became of them.
 */
export default function ApprovalsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isReviewer = canEditTaskPlan(user.role);

  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!projectId) return;
    try {
      setError("");
      setRequests(await getApprovals(projectId));
    } catch (err) {
      setError(readError(err, "We could not load the requests. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const decide = async (request: ApprovalRequest, approve: boolean) => {
    try {
      setBusyId(request._id);
      if (approve) await approveRequest(request._id);
      else await rejectRequest(request._id);
      await load();
    } catch (err) {
      alert(readError(err, "Could not save your decision. Please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  const row = (request: ApprovalRequest) => (
    <li key={request._id} className="approval-row">
      <div className="approval-text">
        <strong>
          {request.type === "create_task" ? "Create" : "Delete"} “{request.taskTitle}”
        </strong>
        <span>
          {isReviewer ? `Asked by ${request.requestedBy?.name ?? "someone"} · ` : ""}
          {request.createdAt ? timeAgo(request.createdAt) : ""}
        </span>
      </div>

      {request.status === "pending" && isReviewer ? (
        <div className="approval-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busyId === request._id}
            onClick={() => decide(request, true)}
          >
            Approve
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busyId === request._id}
            onClick={() => decide(request, false)}
          >
            Reject
          </button>
        </div>
      ) : (
        <span className={`approval-status approval-${request.status}`}>
          {STATUS_LABEL[request.status]}
        </span>
      )}
    </li>
  );

  return (
    <div className="scrum-page">
      <div className="page-header">
        <div>
          <p
            className="eyebrow breadcrumb-link"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            ← Project
          </p>
          <h1>Approvals</h1>
          <p className="page-description">
            {isReviewer
              ? "Developers and testers ask here before creating or deleting a task."
              : "Your requests to create or delete a task, and what a manager decided."}
          </p>
        </div>
      </div>

      {loading && (
        <div className="empty-state">
          <h2>Loading requests...</h2>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <h2>Unable to load requests</h2>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <section className="scrum-panel">
            <div className="scrum-panel-header">
              <h2>
                Waiting <span>{pending.length}</span>
              </h2>
            </div>
            {pending.length === 0 ? (
              <p className="scrum-panel-empty">Nothing is waiting for approval.</p>
            ) : (
              <ul className="approval-list">{pending.map(row)}</ul>
            )}
          </section>

          <section className="scrum-panel">
            <div className="scrum-panel-header">
              <h2>Recent decisions</h2>
            </div>
            {decided.length === 0 ? (
              <p className="scrum-panel-empty">No decisions yet.</p>
            ) : (
              <ul className="approval-list">{decided.map(row)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
