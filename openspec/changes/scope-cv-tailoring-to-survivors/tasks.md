# Tasks

## 1. Scoped tailor step input

- [x] 1.1 Add optional survivor-ID input to `tailorCvsStep` (resolve each via `getJobById`, keep JD filter, `[]` short-circuits to zeros without DB scan or pool) and verify with unit tests asserting empty list returns zeros with zero bridge calls, ID list calls `runCvTailoringForJob` once per ID, and JD-less survivors count as skipped
- [x] 1.2 Preserve legacy no-input behavior (undefined input still queries `getDiscoveredJobs`) with tests asserting existing fan-out/counts/never-throws cases still pass, and document the input contract in code comments verified by reading the step file

## 2. Pipeline wiring + docs

- [x] 2.1 Pass `jobsToProcess` IDs from `runPipeline` into the scoped tailor step after `processJobsStep` and verify with a pipeline/orchestrator test asserting the step receives exactly the survivor IDs and fan-in counts are logged
- [x] 2.2 Update `docs-site/docs/features/cv-automation.md` (scoped eligibility, empty-survivor zeros, no backfill) and verify the documented flow matches the new call site by re-reading both files

## 3. Integration verification

- [x] 3.1 Cover the end-to-end scoping contract with tests asserting a filtered-out `discovered` job gets no bridge call, a survivor gets note + uploaded PDF + `ready`, and an empty-survivor run reports zeros without failing the pipeline
- [x] 3.2 Run targeted suites (`tailor-cvs.test.ts`, bridge tests, pipeline tests) then the repo CI-parity checks, and verify all pass without ignored failures
