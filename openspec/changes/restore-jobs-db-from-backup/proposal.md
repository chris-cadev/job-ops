# Proposal

## Why

`./data/jobs.db` is corrupted (`malformed database schema (sqlite_autoindex_pipeline_search_presets_2) - orphan index`; every CLI connection fails at schema parse, stale `-shm/-wal` present). The verified 2026-10-06 backup (`integrity_check: ok`, 1835 jobs) must replace it before `job-ops` can boot and serve job rows.

## What Changes

- Quarantine current corrupt `data/jobs.db` (+ stale `-shm`/`-wal`) aside; never copy it back to backup storage.
- Copy verified backup `jobs.db` to `./data/jobs.db` with ownership/permission fix and post-copy `file` + `integrity_check` verification.
- Remove stale WAL sidecars as part of replacement so they cannot shadow the restored DB.
- Boot `job-ops` via existing entrypoint guard + idempotent `migrate.ts`; verify jobs list returns backed-up row count.
- Leave `jwt-secret`, `visa-sponsors/`, `rxresume-uploads/` untouched (regenerated/fresh); sidecar PDFs/docs out of scope for this file-only restore.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `database-restore`: extend restore to cover corrupt-current replacement (quarantine + WAL cleanup + post-copy verification), not just empty-dir first-install.

## Impact

- Affected: `./data/jobs.db`, `./data/jobs.db-shm`, `./data/jobs.db-wal`; `docker compose` service `job-ops` restart.
- No code/API changes; no new dependencies.
- Risk: backup is 22 days old (Oct 06 vs Oct 28); rows written Oct 07-28 are lost unless forensically recovered separately.
