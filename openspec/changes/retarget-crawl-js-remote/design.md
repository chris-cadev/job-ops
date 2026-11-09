# Design

## Context

See proposal.md Why. Current state:

- Scheduled runs read the `Tijuana DEV` preset per tick and fan out over its `searchTerms` x `sources` x locations (`scheduled-pipeline-run.ts:156-187`, `discover-jobs.ts:224-307`). Retargeting = editing that row; no deploy.
- Discovery pre-filters on location intent + blocked companies (`discover-jobs.ts:369-433`). `matchJobLocationIntent` matches on-site jobs in listed cities via `selected_location` (`shared/src/job-matching.ts:163-178`) — so under the six-city list, on-site jobs still enter the funnel and remote-must must be enforced downstream.
- `filterNonTargetStep` excludes entry-level titles from LLM classification and leaves them `discovered` (auto-pass) via `isEntryLevelTitle` (`filter-non-target.ts:35-40`, `filter.ts:73-79`).
- `TARGET_PROFILE.md` is the LLM filter's whole world model; its off-target list + entry-level exception encode the old target.

## Goals / Non-Goals

**Goals:**
- Crawl fetches JS-stack queries in the six cities + remote; filter admits remote-only, middle/semi-senior(+Senior) JS roles.
- Entry-level inversion costs zero LLM calls (direct `skipped`, same cheap path as today).
- One-run count comparison against baseline proves the waste is gone.

**Non-Goals:**
- No extractor changes (free-text terms + locations suffice).
- No scoring/selection threshold changes (`topN 10`, `minScore 50` stay).
- No CV tailoring changes; no backfill of old jobs; no schema/API changes.

## Decisions

1. **Preset edit is data, via the searches update endpoint.**
   `PUT /api/pipeline/searches/:id` (or UI equivalent) on `Tijuana DEV`: terms → the five JS terms, cities → the six, sources minus `golangjobs`. Verify with a read-back against the live DB (container volume, not local `data/jobs.db`).
   - Alternative (rejected): code-level term derivation from the profile — over-engineering; the preset already is the targeting knob and re-reads per tick.

2. **Remote-must enforced by profile text + LLM verdict, not by discovery.**
   Discovery keeps matching on-site jobs in listed cities (existing `selected_location` semantics); the rewritten profile makes them off-target with a remote-must reason. Rationale: zero change to discovery behavior/reason counts; post-retarget on-site volume should be small since queries are remote-leaning boards plus cities. Follow-up only if counts show otherwise.
   - Alternative (rejected): drop non-remote in `discoverJobsStep` — cheaper per job but changes discovery semantics and hides the reason from pipeline-visible filter stats.

3. **Entry-level flip reuses the cheap path with inverted verdict.**
   In `filterNonTargetStep`, partition `isEntryLevelTitle` hits out of LLM candidates and `updateJob({ status: "skipped", suitabilityReason: "off-target: entry-level …" })` directly. Keep the `ENTRY_LEVEL_PATTERN` helper shape (tests for the matcher itself stay green); only its call-site verdict changes. The same inversion applies to `classifyJobTarget`'s own short-circuit (found during implementation: it auto-passed entry-level with "kept per profile"), which now returns off-target with a seniority-band reason — otherwise the single-retry fallback path would still admit juniors.
   - Alternative (rejected): send juniors through the LLM — wastes the exact calls this change exists to save.

4. **Profile rewrite names both seniority vocabularies.**
   Middle / Mid-level / Mid / Semi-senior in; Junior / Entry / Intern / Trainee / Graduate out; Tech Lead / Staff / Principal / Manager out; plain hands-on Senior in (recorded assumption for review). Location section: remote-must + six-city reference for the (now rejected) on-site case so verdict reasons stay legible.

## Risks / Trade-offs

- [Risk] Narrowed terms silently lose good jobs (recall) → Mitigation: baseline-vs-new comparison of discovered/filtered/scored/selected counts for one run; terms are data and revert in one edit.
- [Risk] Boards match keywords dumbly (`NestJS` may under-match vs `Node.js`) → Mitigation: keep `Node.js` + `Express` as the broad anchors; counts comparison shows per-term yield if the runner logs it.
- [Risk] Assumption exposure (remote-must scope, Senior-in) → Mitigation: recorded in proposal; reviewer confirms or adjusts profile text before apply completes.
- [Risk] Editing the wrong DB (local vs container volume) → Mitigation: read-back verification task targets the live DB via the API, never a local file.

## Migration Plan

- Apply preset edit → verify read-back → apply profile + pre-rule flip → run one scheduled (or manual same-config) run → compare counts → keep or revert (both reverts are single edits, no persisted state to clean).

## Open Questions

- None blocking. Per-term yield logging (if wanted) is a follow-up, not this change.
