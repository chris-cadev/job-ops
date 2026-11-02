# Tasks

## 1. Pre-checks (stopped, verified source)

- [x] 1.1 Confirm `job-ops` stopped via `docker compose ps` and verify no lock on `./data/jobs.db` via `lsof/fuser`, record output
- [x] 1.2 Verify backup source with `file .../2026-10-06/data/jobs.db` reports SQLite and `sqlite3 ... "PRAGMA integrity_check;"` returns `ok`, record 1835-row count via `SELECT count(*) FROM jobs`
- [x] 1.3 Confirm corrupt current behavior by running `sqlite3 data/jobs.db "PRAGMA integrity_check;"` and capturing orphan-index error for the record

## 2. Quarantine and replace

- [x] 2.1 Rename `data/jobs.db` to `data/jobs.db.corrupt-<timestamp>` and delete `data/jobs.db-shm`/`data/jobs.db-wal`, verify `ls data/*.db*` shows only quarantine
- [x] 2.2 Copy backup `jobs.db` to `data/jobs.db` and fix owner/perms to match `./data`, verify `stat` and readability
- [x] 2.3 Verify restored file with `file data/jobs.db` and `sqlite3 data/jobs.db "PRAGMA integrity_check;"` returns `ok` and `SELECT count(*) FROM jobs` returns 1835

## 3. Boot and acceptance

- [x] 3.1 Start `job-ops` via compose, verify entrypoint guard passes and `migrate.ts` completes by tailing container logs
- [x] 3.2 Verify `/health` returns ok and jobs list returns backed-up row count, record counts; verify missing PDF/doc downloads return not-found per minimal-dir behavior
