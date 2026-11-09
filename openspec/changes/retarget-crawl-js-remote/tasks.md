# Tasks

## 1. Retarget the Tijuana DEV preset

- [x] 1.1 Update the `Tijuana DEV` saved search via the searches update API/UI (`searchTerms` → React, React Native, Node.js, NestJS, Express; `cityLocations` → tijuana, rosarito, ensenada, mexicali, tecate, la paz; sources minus `golangjobs`; topN/minScore unchanged) and verify with an API read-back against the live DB showing exactly that config
- [x] 1.2 Confirm which sources enforce remote-only at query level (JobSpy-backed ones claim to per `pipeline-run.md:80`) versus post-crawl matching, and verify by reading one run's per-source discovered counts plus `reasonCounts` in the discovery log

## 2. Profile rewrite and entry-level flip

- [x] 2.1 Rewrite `TARGET_PROFILE.md` (remote-must rule, six-city reference, seniority band with both LATAM and US phrasing, stack scope, old junior-passes exception removed) and verify by re-reading the file against the spec scenarios, confirming the recorded assumptions (plain Senior in) with the reviewer
- [x] 2.2 Flip the entry-level pre-rule in `filterNonTargetStep` (entry-level titles → direct `skipped` with off-target reason, no LLM call; keep the `ENTRY_LEVEL_PATTERN` helper shape) and verify with unit tests asserting junior titles skip without classification calls and existing matcher tests still pass
- [x] 2.3 Update `filter-non-target.test.ts` / `filter.test.ts` expectations that encode the old auto-pass behavior (e.g. junior-passes cases) and verify the full target-filter suite passes

## 3. Verification run and docs

- [x] 3.1 Run one pipeline with the new preset (scheduled tick or manual same-config run) and verify discovered/filtered/scored/selected counts improve versus baseline with zero `Python`/`Go`-term jobs and no on-site survivors
- [x] 3.2 Document the new target (terms, cities, remote-must, seniority band) in `docs-site/docs/features/pipeline-run.md` alongside the existing preset/remote-filter notes, and verify the documented config matches the live preset read-back from 1.1
