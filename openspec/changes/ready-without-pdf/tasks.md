# Tasks

## 1. Server: not-configured classification and ready-without-PDF fallback

- [x] 1.1 Recon `prepareTailoredResumeForPdf` and `generatePdf` error shapes to confirm no non-rxresume path yields `INVALID_REQUEST` inside the render try, and verify by documenting the examined throw sites in the task review before implementing the fallback gate.
- [x] 1.2 Map `RxResumeAuthConfigError` to `INVALID_REQUEST` in `classifyPdfGenerationError` and verify with unit tests asserting not-configured yields `INVALID_REQUEST` while 401 still yields `UNAUTHORIZED` and 500 still yields `UPSTREAM_ERROR`.
- [x] 1.3 Add the opt-in ready-without-PDF fallback to `generateFinalPdf` (plain status update to `ready`, clear regenerating flag, fire `job_moved_to_ready` but not `resume_generated`, log the skip) with `processJob` opting in, and verify with tests asserting tailoring still runs, status is `ready` with no PDF path, and the explicit generate-pdf route still fails actionably without the flag.
- [x] 1.4 Cover the inherited flows (bulk/stream/single `move_to_ready`, pipeline auto-process, manual-create, background regeneration) with tests asserting ready-without-PDF success on missing key and unchanged actionable failure on invalid key, and update any existing assertions that assumed missing-key failure.

## 2. Client and docs: PDF-less ready jobs

- [x] 2.1 Gate Ready-tab and job-detail PDF affordances on `pdfPath` presence so PDF-less ready jobs display without errors or dead buttons, and verify with a client test rendering a ready job with no PDF path.
- [x] 2.2 Note the no-PDF outcome in bulk success feedback when the fallback engages, and verify with a client test asserting the message appears for fallback runs and not for normal renders.
- [x] 2.3 Extend the bulk-actions recovery doc to distinguish missing key (expected ready-without-PDF, configure a key and generate later) from invalid key (fix the key and retry), and verify field names and steps match the Settings UI.

## 3. Integration verification

- [x] 3.1 Run the CI-parity checks from the repo root (`biome ci`, shared types, orchestrator/extractor types, client build, orchestrator test run under Node 22; rebuild `better-sqlite3` on ABI mismatch) and verify all pass with no ignored failures apart from pre-existing failures documented with clean-tree evidence.

## Workflow follow-up

- Archive the `move-to-ready` change before this one so the shared `job-actions` deltas compose in order.
- Archive this change after the project's review requirements are satisfied.
