import { useCallback, useEffect, useState } from "react";
import { getDeleteRequestState } from "../../api/approvals";

/**
 * The tasks that cannot be asked about any more, so the "Request deletion" button
 * can be switched off: the ones with a request waiting for a manager, and the ones
 * a manager already declined (whoever asked). Only used for developers and testers.
 */
export function usePendingDeletes(projectId: string | undefined, enabled: boolean) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    getDeleteRequestState(projectId)
      .then((state) => {
        if (cancelled) return;
        setPending(new Set((state.pending ?? []).map(String)));
        setDeclined(new Set((state.declined ?? []).map(String)));
      })
      .catch(() => {
        // Not important: the server still refuses a second request.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  const markRequested = useCallback((taskId: string) => {
    setPending((prev) => new Set(prev).add(taskId));
  }, []);

  return { pendingDeleteIds: pending, declinedDeleteIds: declined, markRequested };
}
