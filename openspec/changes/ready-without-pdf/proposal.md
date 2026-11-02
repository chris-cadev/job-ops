# Proposal

## Why

When Reactive Resume is not configured (no API key), every resume-writing path fails and jobs can never reach `ready` — even though tailoring and the status transition don't need rxresume at all. Operators who render CVs elsewhere are stuck: `move_to_ready` just errors.

## What Changes

- When the RxResume API key is **not configured**, resume-writing flows skip the PDF render step and still complete the rest of the work:
  - `move_to_ready` (bulk, stream, and single-job): still runs LLM tailoring, then marks the job `ready` **without** a PDF instead of failing.
  - Pipeline auto-processing and manual-create auto-processing inherit the same fallback wherever they funnel through the shared finalization step.
- A key that **is** configured but rejected (401) keeps the actionable invalid-key error from the `move-to-ready` change — missing and invalid stay distinct.
- Explicit "generate PDF" requests (single-job generate-pdf) keep failing actionably when no key is set — there is no status transition to fall back to, so success-without-PDF would be a lie.
- Ready jobs without a PDF remain fully usable (list, apply flow, later PDF generation once a key is configured); UI treats a missing PDF as absent, not broken.
- No change for typst/latex render paths, which never needed the key.

## Capabilities

### New Capabilities

- `job-actions`: bulk job-action execution and per-job failure reporting, now including the ready-without-PDF fallback when resume rendering is unconfigured. (Note: the unarchived `move-to-ready` change also targets `job-actions`; archive `move-to-ready` first so the deltas compose in order.)

### Modified Capabilities

(none — `database-restore` is unrelated and unchanged)

## Impact

- Server: `orchestrator/src/server/services/pdf.ts` (not-configured classification), `orchestrator/src/server/pipeline/orchestrator.ts` (`generateFinalPdf` fallback to ready-without-PDF + opt-in flag), `orchestrator/src/server/services/jobs/actions.ts` (fallback passthrough), `orchestrator/src/server/repositories/jobs.ts` (no change expected — plain status update already sets `readyAt`), explicit generate-pdf route (unchanged behavior, still errors).
- Client: Ready tab / job detail must handle `ready` jobs with no `pdfPath` (conditional affordances only, no new screens).
- Analytics: `job_moved_to_ready` still fires on the fallback path; `resume_generated` does not (no PDF was generated).
- Docs: bulk-actions recovery note extended (when to fix the key vs. when ready-without-PDF is expected).
