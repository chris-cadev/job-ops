import * as api from "@client/api";
import { useEffect } from "react";
import { identifyAnalyticsUser } from "@/lib/analytics";

export function useAnalyticsIdentity(): void {
  useEffect(() => {
    let cancelled = false;

    void api
      .getCurrentAuthContext()
      .then((context) => {
        if (cancelled) return;
        identifyAnalyticsUser(context.analyticsDistinctId);
      })
      .catch(() => {
        // Ignore auth fetch errors; analytics identity is best-effort.
        if (!cancelled) identifyAnalyticsUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);
}
