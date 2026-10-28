# Tasks

## 1. Pre-verify backup source

- [x] 1.1 Verify source is SQLite with clean state and verify `file .../jobs.db` reports `SQLite 3.x database` and `ls -l` shows `-wal` 0 bytes
- [x] 1.2 Verify integrity and row count and verify `sqlite3 .../jobs.db "PRAGMA integrity_check;"` returns `ok` and `SELECT COUNT(*) FROM jobs;` returns 1835

## 2. Place database (Option A: file first)

- [x] 2.1 Create host `./data/` and copy `jobs.db` and verify `ls -lh ./data/jobs.db` shows ~30M with readable permissions
- [x] 2.2 Confirm guard marker present and no WAL sidecar needed and verify `test -f ./data/jobs.db` passes and no `jobs.db-wal`/`-shm` copied

## 3. Boot job-ops service

- [x] 3.1 Start `job-ops` service only and verify `docker compose up -d job-ops` succeeds and logs show migrations applied without `refusing to boot` guard message
- [x] 3.2 Verify `/health` and jobs API and verify `curl -f http://localhost:3005/health` is 200 and jobs list returns rows with count matching 1835

## 4. Integration and degradation check

- [x] 4.1 Verify login works with regenerated secret and verify fresh login issues a token and old sessions are invalidated as expected
- [x] 4.2 Verify missing sidecars degrade gracefully and verify jobs search/filter works while old pdf/document downloads return not-found instead of boot failure
