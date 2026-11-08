# Design

## Context

See proposal.md Why. Current state:

- `runPipeline` in `orchestrator/src/server/pipeline/orchestrator.ts:528-548` runs `processJobsStep({ jobsToProcess })` (scoped, internal summarize + PDF → `ready`, no note) then `tailorCvsStep({ config })` (unscoped — re-queries `getDiscoveredJobs()` in `steps/tailor-cvs.ts:34`, external ingest → generate → publish → note → export/upload → `ready`).
- `runCvTailoringForJob(jobId, config, { force })` in `services/cv-tailoring-bridge.ts:253` is already per-job and status-tolerant (promotes to `ready` only if still `discovered`, still writes note + PDF for `ready`).
- Scheduled cadence (Thu–Mon 07/13/19 Tijuana) is unchanged; only which jobs the CV phase fans out over changes.

## Goals / Non-Goals

**Goals:**
- Fan-out bounded by the run's survivor list (`jobsToProcess` IDs), not the DB's `discovered` set.
- Keep the per-job chain untouched; change only the step's input plumbing.
- Preserve idempotency (reuse Doc URL line unless `force`) and never-throw fan-in counts.

**Non-Goals:**
- No backfill of pre-existing `ready` jobs.
- No change to scoring/selection thresholds, internal PDF rendering, schedule, schema, or API surface.
- No new CV output type (still one note line + uploaded PDF per survivor).

## Decisions

1. **Pass survivor IDs into `tailorCvsStep`, keep `runCvTailoringForJob` signature.**
   Step gains an optional `jobIds?: string[]` (or `jobs` list); when present it resolves each via `getJobById` and filters to non-empty JD, instead of `getDiscoveredJobs()`. Orchestrator passes `jobsToProcess.map(j => j.id)`.
   - Rationale: smallest blast radius; per-job function already takes `jobId`.
   - Alternative (rejected): filter inside the bridge by score — duplicates selection logic and drifts.

2. **Order stays internal-then-external for survivors.**
   `processJobsStep` runs first (fast internal tailoring + PDF), then scoped tailor overwrites `pdfPath` with `pdfSource: uploaded` + note for the same IDs. Already-`ready` survivors are still processed (bridge tolerates `ready`).
   - Alternative (rejected): skip internal for survivors — saves work but loses fallback when publish fails; defer to a later change if publish proves reliable.

3. **Empty survivors short-circuit to zeros.**
   No DB query, no pool, return `{ attempted: 0, succeeded: 0, failed: 0, skipped: 0 }`.
   - Rationale: matches existing no-JD behavior and keeps run summaries truthful.

4. **No API route in this change.**
   Scoped step is pipeline-only; single-job manual publish stays out of scope.
   - Alternative (deferred): add `POST /api/jobs/:id/cv-tailor` later reusing the same function.

## Risks / Trade-offs

- [Risk] Survivor resolved after internal step is already `ready` with internal PDF; external upload overwrites `pdfPath` → Mitigation: intended (published CV is the survivor output); `pdfSource` distinguishes `uploaded` vs `generated`, prior internal PDF is superseded by design.
- [Risk] `title+employer` slug collision (two jobs same role/company share analysis file + note line) → Mitigation: unchanged from today; `force` regenerates; note key reuse is idempotent, not corrupt.
- [Risk] Long-tail runtime (timeout 420s, concurrency 2) now blocks on up to topN survivors → Mitigation: same bounds as today, but fewer jobs on average; counts logged in fan-in.
- [Risk] Survivor without JD counts as skipped, could confuse `jobsProcessed` vs CV counts → Mitigation: keep phases' counts separate (`processedCount` vs `attempted/succeeded/failed/skipped`).

## Migration Plan

- Deploy server only; no migration, no config change (`enableCvTailoring` + repo path gating unchanged).
- Rollback: revert; unscoped behavior returns, no persisted state to clean (scoped-run notes/PDFs remain valid).
- Docs: extend `docs-site/docs/features/cv-automation.md` recovery note (scoped eligibility + empty-survivor zeros).

## Open Questions

- None blocking. Exact option name (`jobIds` vs `jobs`) settled at implementation against existing step conventions.
