# Design

## Context

See proposal.md Why. Current state:

- `ready` is reachable only via `finalizeGeneratedPdfIfCurrent` (sets `status: ready` + `pdfPath`); `updateJob({ status: "ready" })` would also set `readyAt` via coalesce but no caller does it.
- `generatePdf` catches all render errors into `{ success, error, errorCode }`; a missing key surfaces as `RxResumeAuthConfigError` ("...not configured..."), currently classified as generic `UPSTREAM_ERROR`.
- `generateFinalPdf` is the shared funnel for `processJob` (bulk/stream/single), pipeline auto-processing, manual-create, background regeneration, and the explicit generate-pdf route.
- The `move-to-ready` change (unarchived) maps rxresume 401 → `UNAUTHORIZED` with the invalid-key message.

## Goals / Non-Goals

**Goals:**
- Missing-key fallback in one place (`generateFinalPdf`) so all status-transition flows inherit it.
- Missing vs. invalid keys stay distinguishable end to end.
- Explicit PDF requests never succeed without a PDF.

**Non-Goals:**
- No new `ready` sub-status or schema/migration change; ready-without-PDF is `status: ready` + null `pdfPath`.
- No auto-render when a key is configured later (normal on-demand/background generation already covers it).
- No changes to typst/latex paths or to tailoring.

## Decisions

1. **Classify "not configured" as `INVALID_REQUEST` at the PDF boundary.**
   `classifyPdfGenerationError` maps `RxResumeAuthConfigError` → `"INVALID_REQUEST"`, matching `validateRxresume`'s existing 400 for the same condition. Rationale: reuses the closed `AppErrorCode` vocabulary and existing status mapping; no new codes.
   - Edge for implementation recon: other `AppError(INVALID_REQUEST)`s raised inside `generatePdf`'s try (e.g., tailoring-prep validation) must not trigger the fallback — gate on code **plus** not-configured evidence, and narrow if recon shows a collision.

2. **Fallback lives in `generateFinalPdf` behind an opt-in flag.**
   On not-configured failure with the flag set: skip rendering, set the job `ready` via plain status update (clearing `pdfRegenerating`, restoring pre-step status first as today), fire `job_moved_to_ready`, skip `resume_generated`, log that rendering was skipped for a missing key. `processJob` sets the flag (covers bulk/stream/single, pipeline, manual-create); the explicit generate-pdf route and its tests do not (still fails actionably). Background auto-regeneration passes the flag too — for an already-`ready` job it is a harmless no-op instead of a noisy failure.
   - Alternative (rejected): fallback in each caller — N implementations drifting apart.

3. **Tailoring always runs first (per user decision).**
   `summarizeJob` is rxresume-independent; its failures still fail the run. Only the render step is skippable.

4. **Ready-without-PDF is represented by absence, not a marker.**
   No `pdfPath`, `pdfSource` untouched, `readyAt` via existing coalesce. Client gates PDF affordances on `pdfPath` presence. Rationale: zero migration, `pdfFreshness` and later generation already handle null paths.

5. **Success feedback says what happened.**
   When the fallback engages in a bulk run, the success toast notes the jobs are ready without a PDF (implementation detail, consistent with the specs' success criteria).

## Risks / Trade-offs

- [Risk] `INVALID_REQUEST` collision with non-rxresume validation errors → Mitigation: code-plus-evidence gating; implementation recon task verifies `prepareTailoredResumeForPdf` error shapes first.
- [Risk] Operators mistake "ready without PDF" for fully-done → Mitigation: toast note, docs, absent download button is self-evident; late key + normal generation fills the gap.
- [Risk] Archive-order conflict with `move-to-ready` (same `job-actions` capability) → Mitigation: archive `move-to-ready` first; deltas compose in order.
- [Risk] Background regeneration masking real failures → Mitigation: flag only affects the not-configured case; all other failures keep current noisy behavior.

## Migration Plan

- Deploy server then client; no data migration, no config change.
- Rollback: revert; missing-key runs fail as before, no persisted state to clean (ready-without-PDF jobs from the window stay valid — they list and render normally).

## Open Questions

- None blocking. Exact flag name and toast copy are implementation details settled against existing conventions in tasks.
