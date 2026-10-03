import { useCallback, useEffect, useState } from "react";
import { getApprovals } from "../../api/approvals";

/**
 * The tasks this person has already asked a manager to delete (and the manager
 * has not answered yet), so the "Request deletion" button can be switched off.
 * Only used for developers and testers.
 */
export function usePendingDeletes(projectId: string | undefined, enabled: boolean) {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    getApprovals(projectId)
      .then((list) => {
        if (cancelled) return;
        setIds(
          new Set(
            list
              .filter((r) => r.type === "delete_task" && r.status === "pending" && r.task)
              .map((r) => String(r.task)),
          ),
        );
      })
      .catch(() => {
        // Not important: the server still refuses a second request.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  const markRequested = useCallback((taskId: string) => {
    setIds((prev) => new Set(prev).add(taskId));
  }, []);

  return { pendingDeleteIds: ids, markRequested };
}
