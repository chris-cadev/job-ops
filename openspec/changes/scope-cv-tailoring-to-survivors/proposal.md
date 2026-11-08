# Proposal

## Why

External CV tailoring (`tailorCvsStep` → `runCvTailoringForJob`) re-queries **all** still-`discovered` jobs, ignoring the filtering pile (target filter → suitability score → `topN` select) that the scheduled Thu–Mon runs already computed. Expensive `ingest-jd` + `generate-cv` + GDocs publish runs are spent on jobs that were filtered out, while survivors already moved to `ready` by internal processing never get a published CV note.

## What Changes

- Scope CV tailoring to **survivors only** for newest scheduled runs: only jobs passing the full filtering pile (target filter `skipped` exclusion → `scoreJobsStep` → `selectJobsStep` topN) are eligible for external publish.
- `tailorCvsStep` accepts an explicit survivor ID list from the current run instead of re-querying `getDiscoveredJobs()`; empty survivor set means zero attempts (no fallback to all-discovered).
- No backfill: existing `ready` jobs are untouched; the change applies to newest runs going forward only.
- Internal `processJobsStep` behavior unchanged (still runs on survivors); external publish is the final tail (Doc URL → `Tailored CVs (cv-tailoring)` note → PDF export/upload → `ready`) for those same survivors.
- Counts/logging reflect scoped input (`attempted` = survivors with JD, plus `succeeded/failed/skipped` fan-in as today).

## Capabilities

### New Capabilities

- `pipeline-cv-scope`: CV tailoring eligibility gated by the scheduled-run filtering pile — which jobs qualify for external publish, what happens on empty survivors, and how scoped runs report counts.

### Modified Capabilities

(none — `database-restore` is unrelated and unchanged)

## Impact

- Affected: `orchestrator/src/server/pipeline/orchestrator.ts` (pass survivor IDs into tailor step), `orchestrator/src/server/pipeline/steps/tailor-cvs.ts` (scoped input + tests), pipeline run summary/progress counts, `docs-site/docs/features/cv-automation.md` (scoped behavior note).
- Not affected: `runCvTailoringForJob` per-job chain (ingest → generate → publish → note → export/upload), `processJobsStep`, scoring/selection logic, schedule cadence itself, DB schema, API surface.
- Operational: fewer `generate-cv.py` invocations per run (topN-bounded instead of all-discovered); no overlap risk (scoped step runs after processing as today, same concurrency bounds).
