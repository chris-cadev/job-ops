# Tasks

## 1. Server: preserve and classify the RxResume 401

- [x] 1.1 Propagate the upstream 401 from RxResume import through `generateFinalPdf`/`processJob` (use the existing error-code channel instead of dropping it to a bare message) and verify with a unit test asserting a 401 import yields a coded 401 failure, not a generic error.
- [x] 1.2 Map the coded 401 to the invalid-key per-job result in `executeJobActionForJob` reusing the `validateRxresume` message wording, and verify with a service test asserting `move_to_ready` returns `ok: false` with the authorization code and invalid-key message for 401, and unchanged codes/messages for non-401 failures and the non-`discovered` precondition.
- [x] 1.3 Update existing assertions that expect the old generic code/message for RxResume failures and verify the touched server suites pass (jobs actions, tailoring-flow, pdf/rxresume suites).

## 2. Transport and UI: surface the actionable error

- [x] 2.1 Confirm `/actions` and `/actions/stream` forward the per-job code/message verbatim with no envelope or event-shape change, and verify with a route/stream test asserting `progress` and `completed` events carry the authorization code and invalid-key message with correct succeeded/failed counts.
- [x] 2.2 Render the invalid-key message with a Settings affordance in the bulk-action completion UI while keeping failed jobs selected for retry, and verify with a client test asserting the message and Settings link appear and failed IDs remain selected.
- [x] 2.3 Document the recovery path (regenerate the key in Reactive Resume, update it in JobOps Settings or `RXRESUME_API_KEY`, retry) in the bulk-actions/orchestrator user docs and verify the documented settings field names and steps match the UI and config.

## 3. Integration verification

- [x] 3.1 Run the CI-parity checks from the repo root (`biome ci`, shared types, orchestrator/extractor types, client build, orchestrator test run; rebuild `better-sqlite3` on ABI mismatch) and verify all pass with no ignored failures.
