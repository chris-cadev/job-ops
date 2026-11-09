# Proposal

## Why

The scheduled `Tijuana DEV` crawl searches broad terms (`React`, `Python`, `Go`, …) that drag in off-target jobs — data/ML roles, seniority mismatches, on-site roles — and every one of them burns two LLM calls (target filter + scoring) before rejection. The operator's actual target is narrow (JS stack they know, middle/semi-senior, remote-only) but neither the crawl queries nor the filter profile say so.

## What Changes

- Retarget the `Tijuana DEV` saved search: `searchTerms` become `React`, `React Native`, `Node.js`, `NestJS`, `Express`; `cityLocations` become `tijuana, rosarito, ensenada, mexicali, tecate, la paz`; `golangjobs` source removed (nothing left to feed it). Takes effect on the next scheduled tick (runner re-reads the preset per run — no deploy).
- Rewrite `TARGET_PROFILE.md`: remote is a MUST (any on-site/hybrid role is off-target everywhere, including Baja cities); seniority band is middle/mid-level/semi-senior (Junior/Entry out — removes the old entry-level-passes exception; Tech Lead and above out); stack scope is the five JS terms above.
- Flip the entry-level pre-rule: entry-level titles no longer bypass the LLM filter as auto-pass; they are marked `skipped` as off-target without an LLM call (same cheap path, inverted verdict).
- Keep `topN: 10`, `minSuitabilityScore: 50`, sources otherwise unchanged, schedule unchanged, no extractor changes (free-text query interface is sufficient).

## Capabilities

### New Capabilities

- `crawl-targeting`: saved-search-driven crawl targeting and target-profile eligibility — which terms/cities/sources feed discovery, remote-must eligibility, and the seniority band that decides off-target verdicts.

### Modified Capabilities

(none — `database-restore` is unrelated and unchanged)

## Impact

- Data: `pipeline_search_presets` row `Tijuana DEV` (via searches API/UI; verify against the live DB, not just local `data/jobs.db`).
- Repo: `orchestrator/src/server/services/target-filter/TARGET_PROFILE.md` (profile text), `filter-non-target.ts` (entry-level verdict flip), `services/target-filter/filter.ts` + tests if the entry-level helper changes shape.
- Not affected: extractor query plumbing, scoring/selection logic, CV tailoring scope, schedule cadence, DB schema, API surface.
- Operational: fewer, more relevant jobs per run → less LLM filter/score spend; recall risk on narrowed terms (mitigated by comparing discovered/filtered counts against baseline for one run). Rollback: restore preset row + profile file.
- Assumptions recorded for review: (1) "remote is a must" means on-site is off-target even in Baja cities; (2) plain Senior (hands-on, non-lead) stays target while Junior/Entry, Tech Lead, Staff/Principal do not.
