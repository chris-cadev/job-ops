# Design

## Context

See proposal.md Why. Current state (observed in code and container logs on 2026-11-01):

- `move_to_ready` runs `processJob()` = `summarizeJob()` (LLM tailoring, succeeded) then `generateFinalPdf()` (failed at `POST /api/openapi/resumes/import` with 401 `Invalid API key`, renderer `rxresume`).
- The 401 loses its identity on the way out: `processJob` returns `{ success, error }` with no code, and `executeJobActionForJob` rethrows it as generic `500 INTERNAL_ERROR`. The per-job `JobActionResult` envelope already supports `{ code, message }`, and the SSE stream passes results through unchanged.
- `validateRxresume` in `onboarding-status.ts` already owns the user-facing invalid-key message (`Reactive Resume v5 API key is invalid. Update the API key and try again.`).
- API response contract (`{ ok, data/error, meta.requestId }`), correlation IDs, and redaction rules per AGENTS.md constrain the change.

## Goals / Non-Goals

**Goals:**
- Preserve the upstream 401 identity from RxResume import through to the per-job action result on both `/actions` and `/actions/stream`.
- Give the bulk-action UI a message it can render with a Settings affordance, reusing existing wording.
- Leave happy path, preconditions, concurrency (4), and SSE shapes untouched.

**Non-Goals:**
- No automatic key rotation, re-auth flow, or RxResume provisioning changes.
- No change to `skip`/`rescore` semantics or to non-401 PDF/LLM error handling.
- No new SSE event types or response envelope changes.

## Decisions

1. **Classify at the PDF/RxResume boundary, propagate as data, map once in `jobs/actions`.**
   Have `generateFinalPdf`/`processJob` return the upstream status (401) alongside the message (existing `errorCode` field on the PDF result, currently dropped by `processJob`), and map 401 to the user-facing invalid-key message at the single `executeJobActionForJob` mapping point.
   - Rationale: one mapping point keeps `/actions`, `/actions/stream`, and `/:id/process` consistent; the transport already forwards `results` verbatim.
   - Alternative (rejected): mapping inside `pdf.ts` to a UI string — would couple a shared PDF service to job-action UX wording.

2. **Reuse the `validateRxresume` invalid-key message text for the per-job message.**
   - Rationale: consistency with Settings validation; operators see the same instruction in both places.
   - Alternative (rejected): a new distinct message — risks two wordings for one fix drifting apart.

3. **Keep the error code in the existing `AppErrorCode` vocabulary (e.g. upstream/auth family) rather than inventing a transport-level code.**
   - Rationale: `mapJobActionFailure` and status mapping already handle the known codes; per-job results carry `code` as string so clients degrade gracefully.
   - Alternative (rejected): brand-new code end to end — larger blast radius on status mapping and client matching.

4. **Client renders the message from the result payload; no new fetching.**
   - Rationale: the completed/stream payload already contains per-result messages; the bulk toast/detail reads them. Failed IDs already stay selected, so retry is free.

## Risks / Trade-offs

- [Risk] Clients or tests asserting `INTERNAL_ERROR` for RxResume 401 now see a different code → Mitigation: update the affected assertions; counts and shapes are unchanged so UI parsing cannot break.
- [Risk] Leaking key material or tenant context in messages → Mitigation: message is a fixed template with no key, job description, or profile content; keep full error (with requestId/jobId) in structured logs only, per redaction rules.
- [Risk] Stored key invalid for only one of several configured keys (multi-key retry in `v5.ts`) → Mitigation: classify only after all key attempts return 401, matching existing retry semantics.
- [Risk] Scope creep into a general PDF-error taxonomy → Mitigation: this change classifies 401 only; other statuses keep current behavior (spec Non-auth requirement).

## Migration Plan

- Deploy server then client; no data migration, no config change.
- Rollback: revert; old generic `500` message returns, no persisted state to clean.
- Operator recovery (docs): regenerate the key in Reactive Resume, update it in JobOps Settings (or `RXRESUME_API_KEY`), retry the retained selection.

## Open Questions

- None blocking. Exact `AppErrorCode` choice (e.g. `UPSTREAM_ERROR` vs `UNAUTHORIZED`) is an implementation detail settled in tasks against the existing status map.
