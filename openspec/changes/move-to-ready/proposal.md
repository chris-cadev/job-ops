# Proposal

## Why

Bulk `Move to Ready` fails opaquely: the UI toasts `0 succeeded, 2 failed` with no actionable reason, while container logs show the real cause is Reactive Resume returning `401 Invalid API key` during PDF generation. Users reasonably assume move-to-ready is a simple state change, so an auth failure in a downstream renderer is surprising and unactionable.

## What Changes

- Classify Reactive Resume `401` failures during `move_to_ready` as an actionable auth error (distinct from generic PDF/INTERNAL errors) end to end.
- Propagate the classified per-job error code and message through `POST /api/jobs/actions` and `POST /api/jobs/actions/stream` results without changing the success envelope.
- Surface the actionable message in the bulk-action UI (toast + per-run detail) pointing at Settings where the RxResume API key is configured, reusing the existing `validateRxresume` wording.
- Keep the happy path, status preconditions (`discovered` only), concurrency, and SSE event shapes unchanged.
- Document the recovery path (regenerate the key in Reactive Resume, update it in JobOps Settings, retry).

## Capabilities

### New Capabilities

- `job-actions`: bulk job-action execution (`move_to_ready`, `skip`, `rescore`) and actionable per-job failure reporting, including downstream-dependency auth failures.

### Modified Capabilities

(none — `database-restore` is unrelated and unchanged)

## Impact

- Server: `orchestrator/src/server/services/jobs/actions.ts` (error mapping), `orchestrator/src/server/services/pdf.ts` + `orchestrator/src/server/services/rxresume/` (401 classification), `orchestrator/src/server/api/routes/jobs/actions.ts` (payload passthrough, no shape change).
- Client: `orchestrator/src/client/pages/orchestrator/useJobSelectionActions.tsx` (toast/detail rendering), error-toast helpers.
- Settings validation reuse: `orchestrator/src/server/services/onboarding-status.ts` (`validateRxresume` invalid-key message).
- Docs: bulk-actions / orchestrator user docs recovery note.
- No API breaking change: `JobActionResult` already carries `{ code, message }` per job; only the values become specific.
