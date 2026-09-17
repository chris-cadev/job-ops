---
id: cv-automation
title: CV Automation
description: Existing CV creation pieces in job-ops and cv-tailoring, and how they connect today.
sidebar_position: 6
---

## What it is

Two separate systems automate parts of CV creation. They are half-connected through files and SQLite, with no return path.

- **job-ops** creates per-job PDFs: profile → LLM tailoring (`headline`/`summary`/`skills` + project pick) → local LaTeX/Typst render or Reactive Resume export. Source: `orchestrator/src/server/services/profile.ts`, `summary.ts`, `projectSelection.ts`, `pdf.ts`, `auto-pdf-regeneration.ts`, `rxresume/tailoring.ts`, `orchestrator/src/server/pipeline/orchestrator.ts`.
- **cv-tailoring** (`../cv-tailoring`) creates full ATS markdown CVs plus styled Google Docs: JD file → analysis → tailored CV → publish. Source: `_shared/pipeline.py`, `_shared/ingest-jd.py`, `_shared/generate-cv.py`, `_shared/gdocs_publish.py`, `_shared/lib.py`, `run.py`.

## Why it exists

- job-ops needs a tailored PDF per job to attach to applications.
- cv-tailoring needs a deeply tailored narrative CV per target role, built from a full career inventory and evidence library.
- Both read job descriptions, but they solve different outputs: job-ops patches fields onto a baseline resume; cv-tailoring rewrites the whole story.

## How to use it

### Landscape: what is connected today

```mermaid
flowchart LR
  subgraph JO[job-ops]
    P[profile<br/>profile.ts<br/>design-resume]
    T[tailoring<br/>summary.ts + projectSelection.ts]
    R[PDF render<br/>pdf.ts + resume-renderer<br/>rxresume/tailoring.ts]
    PL[pipeline<br/>orchestrator.ts<br/>summarizeJob + generateFinalPdf]
    P --> T --> R
    PL --> T
    PL --> R
  end
  subgraph CT[cv-tailoring]
    JD[JD file]
    IN[ingest-jd.py]
    AN[04-target-role-analysis]
    GEN[generate-cv.py]
    PUB[gdocs_publish.py]
    JD --> IN --> AN --> GEN --> PUB
  end
  JO -- "jd-sync writes DB + JD md files" --> JD
  CT -- "pipeline.py reads jobs.db discovered rows" --> JO
  CT -. "no write-back of CV path or Doc URL" .-> JO
```

The only live seam is file + SQLite: `jd-sync` produces `JD - {Role} - {Company}.md` files that cv-tailoring consumes, and `_shared/pipeline.py` hardcodes `COMPOSE_FILE` and `JOB_OPS_DB` to read `jobs WHERE status='discovered'` rows. There is no HTTP API, webhook, or write-back of the generated CV into job-ops.

### job-ops internal CV flow

```mermaid
flowchart TD
  A["GET /api/profile<br/>profile.ts + design-resume"] --> B["POST /api/jobs/:id/summarize<br/>summarizeJob"]
  B --> C["generateTailoring JD + profile<br/>summary.ts LLM JSON headline/summary/skills"]
  C --> D["pickProjectIdsForJob<br/>projectSelection.ts"]
  D --> E["jobs.tailored_* + selectedProjectIds CSV"]
  E --> F["POST /api/jobs/:id/generate-pdf<br/>generateFinalPdf"]
  F --> G["prepareTailoredResumeForPdf<br/>rxresume/tailoring.ts"]
  G --> H["resume-renderer latex/typst or RxResume export<br/>pdfs/tenant/resume_jobId.pdf"]
  H --> I["auto-pdf-regeneration queue<br/>ready + generated + stale only"]
  J["PATCH /api/jobs/:id<br/>manual tailoring edits"] --> I
  K["PATCH /api/design-resume<br/>baseline edits"] --> I
```

Steps:

1. Open **Resume Studio** (`GET /api/design-resume`) or import from Reactive Resume. This is the primary profile source via `designResumeToProfile()`; upstream RxResume is the fallback.
2. Run `POST /api/jobs/:id/summarize[?force=1&fields=summary,headline,skills]` to LLM-generate tailoring and project picks into `jobs.tailoredSummary/tailoredHeadline/tailoredSkills/selectedProjectIds`.
3. Run `POST /api/jobs/:id/generate-pdf` (or `POST /api/jobs/:id/process`, or `POST /api/pipeline/run`) to render `resume_<jobId>.pdf` with `prepareTailoredResumeForPdf` + `resume-renderer`.
4. Edit manually with `PATCH /api/jobs/:id` (`tailoredSummary`, `tailoredHeadline`, `tailoredSkills` as JSON string, `selectedProjectIds` CSV). Baseline edits in Resume Studio and settings changes enqueue `auto_pdf_regeneration` for `ready` jobs with system-generated stale PDFs.

Ghostwriter (`/api/jobs/:id/chat/...`, `services/ghostwriter.ts`) is chat-only. It snapshots tailoring read-only into the prompt and never writes back to the CV.

### cv-tailoring pipeline

```mermaid
flowchart TD
  A["JD file<br/>00-source-reference/JD - Role - Company.md"] --> B["ingest-jd.py<br/>LLM: JD Breakdown + Evidence Map + Narrative Angle"]
  B --> C["04-target-role-analysis/role--company.md<br/>+ current-target.md pointer"]
  C --> D["generate-cv.py<br/>analysis + protocol + JD + cv--general.md<br/>+ all inventory + all evidence"]
  D --> E{"parse_ats roles == 0?"}
  E -->|yes| F["FATAL, no output"]
  E -->|no| G["05-narrative-generation/cv--slug--ats.md"]
  G --> H["gdocs_publish.py<br/>copy template + fill + styled Google Doc URL"]
  I["pipeline.py --sync --no-select --no-publish"] --> B
  I --> D
  I --> H
  J["run.py + completed-cvs.txt<br/>batch over hardcoded FILES"] --> D
```

Steps (from `../cv-tailoring`):

1. `python _shared/pipeline.py --sync` syncs JDs from job-ops (`docker compose exec job-ops npm run jd-sync`), then ingests and generates.
2. `python _shared/ingest-jd.py "<JD file>"` parses `Company`/`Role` from the filename, runs the LLM analysis, and overwrites `04-target-role-analysis/current-target.md`.
3. `python _shared/generate-cv.py <analysis> [--no-questions|--no-publish]` assembles inventory (`01-career-inventory/roles/`), evidence (`_shared/02-evidence-library/`), methodology (`_shared/01-knowledge-base/` + `00-career-intelligence-protocol.md`), and the JD; writes `cv--{slug}--ats.md`; refuses to write when `parse_ats()` finds zero roles.
4. Publishing via `gdocs_publish.py` copies the Google Docs template and fills `{{EXPERIENCE.*}}` blocks, returning a Doc URL. `run.py` is the legacy batch runner with a `completed-cvs.txt` checkpoint.

### Integration seams and data contracts

```mermaid
flowchart LR
  subgraph Contracts
    A["job-ops in:<br/>jobDescription + ResumeProfile<br/>+ writingStyle + resumeProjects settings"]
    B["job-ops out:<br/>jobs.tailored_* + selectedProjectIds<br/>+ resume_jobId.pdf + pdfFingerprint"]
    C["cv-tailoring in:<br/>JD md + 00--profile.md + roles<br/>+ evidence lib + knowledge base"]
    D["cv-tailoring out:<br/>cv--slug--ats.md + Google Doc URL"]
  end
  A --> B
  C --> D
  B -. "only JD text flows forward" .-> C
  D -. "missing: CV path/URL into jobs row" .-> B
```

| Direction | Mechanism | Status |
|---|---|---|
| job-ops → cv-tailoring | `jd-sync` JD markdown files + SQLite `jobs` `discovered` rows read by `find_discovered_jds()` | Connected, read-only |
| job-ops → cv-tailoring | `suitability_score` + location ordering reused by `select_jds()` picker | Connected, file-local |
| cv-tailoring → job-ops | `parse_ats()` zero-roles guard reusable as pre-publish check | Not wired |
| cv-tailoring → job-ops | Write-back of `cv--slug--ats.md` path + Doc URL into `jobs` row or artifact store | Missing |
| Either → either | HTTP API or webhook trigger | Missing |

```mermaid
flowchart TD
  A["jobs.status = discovered<br/>+ job_description"] --> B["jd-sync JD md dump"]
  B --> C["cv-tailoring pipeline.py --sync"]
  C --> D["cv--slug--ats.md + Doc URL"]
  D -. "no return edge (manual flow)" .-> E["jobs.tailored_* / resume_jobId.pdf"]
  E --> F["application"]
  style D fill:#fff3cd
  style E fill:#f8d7da
```

### Connected flow (opt-in pipeline phase)

When `enableCvTailoring` is set (per run via `POST /api/pipeline/run`, via the `cvTailoringEnabled` setting, or via `PIPELINE_ENABLE_CV_TAILORING=1` for `pipeline:run`), the pipeline adds a fan-out/fan-in phase after `processJobsStep`:

```mermaid
flowchart TD
  A["processJobsStep done"] --> B["tailorCvsStep<br/>input: all discovered jobs with JD"]
  B --> C["per job, concurrency = cvTailoringConcurrency ?? 2<br/>ingest-jd.py + generate-cv.py --no-questions"]
  C --> D["parse Doc URL from stdout"]
  D --> E["upsert Tailored CVs note<br/>append Doc URL line"]
  E --> F["export Doc to PDF + upload<br/>discovered -> ready"]
  F --> G["allSettled join<br/>counts logged, never throws"]
```

1. Configure the bridge: set `CV_TAILORING_REPO_PATH` (or the `cvTailoringRepoPath` setting) to the cv-tailoring checkout. Without it the phase warns and skips; the pipeline still completes.
2. Tune load with `cvTailoringConcurrency` (default 2) and `cvTailoringTimeoutSec` (default 420, passed as `generate-cv.py --timeout`).
3. Each job gets one `Tailored CVs (cv-tailoring)` note; re-runs append new Doc URL lines instead of creating new notes, and skip regeneration when the URL is already present unless forced.
4. The published Doc is exported to PDF and uploaded through the same path as `POST /api/jobs/:id/pdf`, so `discovered` jobs are promoted to `ready`.
5. Single failure never fails the pipeline: per-job errors are logged with `requestId`/`pipelineRunId`/`jobId` and counted in the fan-in summary.

Requires pre-provisioned Google auth (`_shared/gdocs/token.json`) in the cv-tailoring repo, otherwise generation succeeds but publishing/export has no URL to link.

## Common problems

- Ghostwriter never writes to the CV. Copy-paste into `PATCH /api/jobs/:id` is the only path from chat to tailoring.
- `POST /:id/summarize?fields=` supports partial regen, but `processJob` and pipeline never pass `fields`; stale `skills` alone never triggers regen without `force`.
- `generateFinalPdf` renders even when `job.tailored*` is empty. Empty-summary PDFs succeed silently.
- `applyTailoredSummary/Skills` in `rxresume/tailoring.ts` return early when resume shapes are missing. Tailoring can be dropped with success status.
- Resume Studio preview (`generateDesignResumePdf`) uses no tailoring or project pick. There is no tailored-preview-before-ready endpoint.
- Auto-regen only covers `ready + generated + stale`. `discovered`/`processing` jobs and uploaded PDFs (`pdfSource=uploaded` nulls the fingerprint) go stale with no indicator.
- Single-overwrite PDF path (`resume_<jobId>.pdf`): concurrent edits can leave new bytes with an old fingerprint, immediately `stale`.
- `enableAutoTailoring: true` in pipeline defaults is never checked; `processJobsStep` always tailors and renders.
- Fragile hard-fails: tracer without public URL/jobId throws `prepareTailoredResumeForPdf`; missing Studio doc and `rxresumeBaseResumeId` throws `loadBaseResumeSource`; pictures are stripped unless publicly reachable.
- Source ambiguity: Studio wins silently over RxResume; only `GET /profile/status` hints at the fallback chain.
- cv-tailoring gaps: hardcoded absolute `COMPOSE_FILE`/`JOB_OPS_DB` paths, single `software-engineer/` domain, filename-as-ID (collisions, `MAX_PATH` slug truncation), Windows-only `msvcrt` picker, secrets in `gdocs/config.ini` + `token.json`, `completed-cvs.txt` vs DB state divergence.

## Related pages

- `/docs/features/design-resume` — Resume Studio baseline editing.
- `/docs/features/ghostwriter` — per-job chat assistant (read-only for CVs).
- `/docs/features/reactive-resume` — upstream resume fallback and export path.
- `/docs/features/pipeline-run` — `summarizeJob` + `generateFinalPdf` orchestration.
- `/docs/features/tracer-links` — tracer rewrite inside `prepareTailoredResumeForPdf`.
- `/docs/workflows/find-jobs-and-apply-workflow` — end-to-end job flow.
- `/docs/reference/jd-sync-reference` — JD sync contract cv-tailoring consumes.
