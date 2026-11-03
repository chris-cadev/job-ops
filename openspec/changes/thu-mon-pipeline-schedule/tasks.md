# Tasks

## 1. Schedule defaults

- [x] 1.1 Update `SCHEDULED_PIPELINE_CRON` default to `0 7,13,19 * * 4,5,6,0,1` in `docker-compose.yml` (and the Fri/Sat/Sun/Mon comment above it) and verify `grep -n SCHEDULED_PIPELINE_CRON docker-compose.yml` shows the new value
- [x] 1.2 Update the commented schedule block in `.env.example` (cron line + weekly-window comment) to the Thu–Mon thrice-daily cadence and verify the file renders the new example

## 2. Coverage for the new cadence

- [x] 2.1 Add `scheduled-pipeline-run.test.ts` cases for `0 7,13,19 * * 4,5,6,0,1`: next-tick on an active Mon evening, Tue/Wed silence (next tick Thu 07:00 Tijuana), and one existing Fri/Sat/Sun tick, and verify `npm --workspace orchestrator run test:run -- scheduled-pipeline-run` passes
- [x] 2.2 Add a startup-decision case proving the Tue/Wed gap collapses to one catch-up run (last run Mon 19:00 window, boot Thu → `missed-tick` run-once) and verify the same test command passes

## 3. Deploy verification

- [x] 3.1 Redeploy/restart the `job-ops` container so the schedule re-resolves at boot and verify the startup log shows `Scheduled pipeline run { nextRun, cron: "0 7,13,19 * * 4,5,6,0,1", timeZone: "America/Tijuana" }`
- [x] 3.2 Confirm no code changes to `scheduled-pipeline-run.ts` state machine were needed and verify `git status --porcelain` shows only `docker-compose.yml`, `.env.example`, and the test file
