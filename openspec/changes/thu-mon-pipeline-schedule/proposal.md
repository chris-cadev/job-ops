# Proposal

## Why

The pipeline currently runs 4x weekly (Fri/Sat/Sun/Mon at 20:47 Tijuana). The user wants fresher results during the active job-seeking window with three daily runs (07:00, 13:00, 19:00) Thu through Mon, keeping Tue/Wed as off days to limit cost and extractor load.

## What Changes

- Change the default `SCHEDULED_PIPELINE_CRON` from `47 20 * * 1,5,6,0` to `0 7,13,19 * * 4,5,6,0,1` (America/Tijuana).
- Keep `SCHEDULED_PIPELINE_TIMEZONE=America/Tijuana` and existing `SEARCH_NAME` / `TENANT_ID` / `USER_ID` wiring unchanged.
- No code changes to the scheduler state machine (startup catch-up, tick single-flight, croner TZ handling all stay as-is).
- Update `.env.example` and `docker-compose.yml` comments/defaults to document the new cadence.
- Restart/redeploy the container so the schedule is re-resolved at boot.

## Capabilities

### New Capabilities

- `scheduled-pipeline`: cron-driven automatic pipeline runs for a saved search, including cadence, timezone handling, startup catch-up, and tick single-flight behavior.

### Modified Capabilities

(none — no existing spec covers scheduling)

## Impact

- Affected: `docker-compose.yml` (env defaults + comments), `.env.example` (docs), runtime schedule only.
- Not affected: `orchestrator/src/server/services/scheduled-pipeline-run.ts` logic, DB schema, API surface, visa-sponsor/backup schedulers.
- Operational: 4 runs/week → 15 runs/week (~3.75x LLM scoring calls and pipeline_rows); 6h intra-day spacing vs. 10–30 min typical runtime, so no overlap expected; Tue/Wed gap collapses to a single Thu 07:00 catch-up after outages (existing non-cumulative behavior).
