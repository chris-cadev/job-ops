---
id: run-pipeline-from-any-stage
title: Run the Pipeline From Any Stage
description: How-to guide with the exact command for each pipeline stage, so you always know what to run next.
sidebar_position: 4
---

## Goal

You are somewhere in the middle of the pipeline (for example, jobs are already filtered) and want to know the exact command that continues from there.

This guide lists every stage in run order with its entry points: UI, API (`BASE` below means your server, default `http://localhost:3001`), and CLI (run from the repository root unless noted).

All API responses follow `{ ok, data/error, meta: { requestId } }`. The pipeline runs in the background: `POST /api/pipeline/run` returns `{"message": "Pipeline started"}` immediately.

## 0) Full run from scratch

Use this when you want the whole flow: discover → import → filter → score → select → process → (optional) CV tailoring.

```powershell
curl -X POST http://localhost:3001/api/pipeline/run `
  -H "Content-Type: application/json" `
  -d '{"topN": 10, "minSuitabilityScore": 50, "enableCvTailoring": true}'
```

Options: `sources` (e.g. `["linkedin", "indeed"]`), `runBudget`, `searchTerms`, `country`, `cityLocations`, `workplaceTypes`, `searchScope`, `matchStrictness`, `enableCvTailoring`.

Headless alternative (cron/n8n, from `orchestrator/`):

```powershell
$env:PIPELINE_TOP_N = "10"
$env:PIPELINE_MIN_SCORE = "50"
$env:PIPELINE_ENABLE_CV_TAILORING = "1"
npm run pipeline:run
```

Or from the UI: the pipeline/run control on the **Jobs** page.

## 1) Discovery (crawling extractors)

You are here when: a run just started, or `GET /api/pipeline/progress/snapshot` shows step `crawling`.

There is no standalone "crawl only" command; crawling happens inside a full run (step 0). Two pauses can stop you here:

**Cloudflare challenge pause** (`challenge_required`):

```powershell
curl http://localhost:3001/api/pipeline/challenges
curl -X POST http://localhost:3001/api/pipeline/challenge-viewer
curl -X POST http://localhost:3001/api/pipeline/solve-challenge `
  -H "Content-Type: application/json" `
  -d '{"extractorId": "<id-from-challenges>"}'
```

Solving resumes the pipeline automatically; solved cookies are reused on retry and future runs. Timeout is ~5 minutes.

**LLM-not-configured pause** (scoring cannot start):

1. Set the API key in **Settings**.
2. Resume without restarting the run:

```powershell
curl -X POST http://localhost:3001/api/pipeline/resume-scoring
```

## 2) Import (discovered jobs land in the DB)

You are here when: crawling finished and jobs appear with status `discovered`.

Normally automatic (`importJobsStep`). If a source was missed, add the job manually instead of re-crawling everything:

```powershell
curl -X POST http://localhost:3001/api/manual-jobs/fetch `
  -H "Content-Type: application/json" `
  -d '{"url": "https://www.linkedin.com/jobs/view/123"}'
curl -X POST http://localhost:3001/api/manual-jobs/import `
  -H "Content-Type: application/json" `
  -d '{"jobUrl": "https://example.com/jobs/backend-engineer"}'
```

There is also `POST /api/manual-jobs/infer` (fill fields from a URL before importing). The UI equivalent is the manual-import sheet on the Jobs page.

## 3) Filtered stage (off-target jobs skipped)

You are here when: jobs are `discovered` and you want off-target ones marked `skipped` before scoring.

Standalone command (from `orchestrator/`, no full run needed):

```powershell
npm run filter:target
```

Optional: `$env:TARGET_FILTER_TENANT_ID = "<tenant>"` (defaults to `tenant_default`). Output prints `Checked / Skipped / Last run`. The same step runs automatically inside every pipeline run after import.

Next from here: score (step 4) or jump straight to per-job processing (step 6).

## 4) Scoring (suitability score per job)

You are here when: jobs are `discovered`, unscored, and the filter already ran.

Scoring runs automatically in the pipeline. To score outside a run, rescore per job or in bulk:

```powershell
curl -X POST http://localhost:3001/api/jobs/<id>/rescore
curl -X POST http://localhost:3001/api/jobs/actions `
  -H "Content-Type: application/json" `
  -d '{"action": "rescore", "jobIds": ["<id1>", "<id2>"]}'
```

Low-score jobs auto-skip when `autoSkipScoreThreshold` is set (see `/docs/features/settings`).

## 5) Selection (top-N shortlist)

You are here when: jobs are scored and you want to know which ones the pipeline will process.

There is no command: selection is a pure function of `topN` + `minSuitabilityScore` over scored jobs. To change the outcome, rerun with different values (step 0) or bypass selection entirely by processing jobs individually (step 6).

## 6) Processing (tailoring + PDF per job)

You are here when: a job is selected (or any `discovered` job you want to push forward).

Full per-job equivalent of the pipeline step:

```powershell
curl -X POST http://localhost:3001/api/jobs/<id>/process
```

Granular pieces (same order the pipeline uses internally):

```powershell
curl -X POST "http://localhost:3001/api/jobs/<id>/summarize?force=1&fields=summary,headline,skills"
curl -X POST http://localhost:3001/api/jobs/<id>/generate-pdf
```

Bulk equivalent for many jobs (streams progress with `/actions/stream`):

```powershell
curl -X POST http://localhost:3001/api/jobs/actions `
  -H "Content-Type: application/json" `
  -d '{"action": "move_to_ready", "jobIds": ["<id1>", "<id2>"]}'
```

Actions: `skip`, `rescore`, `move_to_ready` (add `"options": {"force": true}` to force). Skip one job: `POST /api/jobs/<id>/skip`.

## 7) CV tailoring phase (external CVs + note links)

You are here when: jobs are processed and you want full tailored CVs from `../cv-tailoring` linked in each job's notes.

There is no standalone endpoint; rerun the pipeline with the flag (the phase covers every `discovered` job with a description, then joins before completion):

```powershell
curl -X POST http://localhost:3001/api/pipeline/run `
  -H "Content-Type: application/json" `
  -d '{"enableCvTailoring": true}'
```

Prerequisites, otherwise the phase warns and skips while the pipeline still completes:

1. `CV_TAILORING_REPO_PATH` (env or `cvTailoringRepoPath` setting) points at the cv-tailoring checkout.
2. `_shared/gdocs/token.json` exists there (one-time browser login).
3. Optional tuning: `cvTailoringConcurrency` (default 2), `cvTailoringTimeoutSec` (default 420).

Each job gets one `Tailored CVs (cv-tailoring)` note with appended Google Doc links; the Doc is exported to PDF and uploaded, promoting `discovered` jobs to `ready`. Details: `/docs/features/cv-automation`.

## 8) JD dump for external tools

You are here when: an external tool (cv-tailoring scripts, manual review) needs the raw job descriptions as files.

```powershell
npm run jd-sync
```

Writes up to 500 `JD - {title} - {employer}.md` files to `JD_OUTPUT_DIR` (default `/app/jds`), skipping files that already exist. The pipeline also dumps fresh descriptions to the same directory on every run.

## 9) Observe, inspect, stop

```powershell
curl http://localhost:3001/api/pipeline/status
curl http://localhost:3001/api/pipeline/progress/snapshot
curl http://localhost:3001/api/pipeline/runs
curl http://localhost:3001/api/pipeline/runs/<runId>/insights
curl -X POST http://localhost:3001/api/pipeline/cancel
```

Live progress (SSE): `GET /api/pipeline/progress`. Every response carries an `x-request-id` header; include it when reporting problems.

## Common problems

- `409 Pipeline is already running`: wait or `POST /api/pipeline/cancel` first.
- `409 No running pipeline to cancel`: nothing is running; check `/status`.
- `409 Pipeline is not paused waiting for LLM configuration`: the run is not in the LLM pause; check `/progress/snapshot`.
- `404 No pending challenge for extractor`: the challenge already resolved or expired; check `/challenges`.
- CV phase skipped silently: `CV_TAILORING_REPO_PATH` unset or `token.json` missing; check server logs for the warn line.
- Stale `discovered` jobs after days away: rerun the pipeline before reviewing; results are not auto-refreshed.

## Related pages

- `/docs/features/pipeline-run` — stage-by-stage behavior reference.
- `/docs/features/cv-automation` — CV creation pieces and the connected flow.
- `/docs/workflows/find-jobs-and-apply-workflow` — recommended end-to-end order.
- `/docs/getting-started/jd-sync` — JD sync setup.
- `/docs/reference/jd-sync-reference` — JD file contract.
- `/docs/troubleshooting/common-problems` — general failure recovery.
