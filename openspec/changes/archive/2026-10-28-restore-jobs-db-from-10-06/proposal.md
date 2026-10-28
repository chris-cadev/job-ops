# Proposal

## Why

The live `./data/jobs.db` was lost with the WSL/Omarchy wipe. A verified SQLite backup from 2026-10-06 (30M, 1835 jobs, `integrity_check: ok`, clean WAL) exists on `/mnt/backup`. Restoring those rows is required before the pipeline, search, and tailoring flows are usable again.

## What Changes

- Restore `jobs.db` from `/home/chris/disks/backup/backups/job-ops-2026-10-06/data/jobs.db` to host `./data/jobs.db` (Option A: place file first, then boot).
- Boot only the `job-ops` service; leave `rxresume-db`/`rxresume-app` and 10-03 pgdata/JDs out of scope.
- Discard sidecars if they block: `jwt-secret` regenerates, `pdfs/`, `job-documents/`, `visa-sponsors/`, `models.db` are not copied.
- Verify row count (1835), `/health`, and jobs list after boot.

## Capabilities

### New Capabilities

- `database-restore`: Restoring the primary SQLite database (`jobs.db`) from a verified filesystem backup into the active data directory so the app boots with historical rows intact.

### Modified Capabilities

- None.

## Impact

- Affected: host `./data/` (new file), `job-ops` container (`./data:/app/data`), DB migrations (`orchestrator/src/server/db/migrate.ts`), entrypoint guard (`docker-entrypoint.sh`), auth sessions (reset on new `jwt-secret`).
- No API, schema, or dependency changes. No changes to rxresume Postgres volumes or JDs volume.
