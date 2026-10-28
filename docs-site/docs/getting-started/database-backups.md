---
id: database-backups
title: Database Backups
description: Configure, run, and restore JobOps database backups.
sidebar_position: 2
---

## What this covers

This page is about database backups:

- automatic backup schedule
- manual backup creation/deletion
- retention behavior
- restore workflow
- backup troubleshooting

## Backup behavior

JobOps stores backups in the same data directory as `jobs.db`.

Two backup types exist:

- **Automatic** backups
- **Manual** backups

### Automatic backups

- Scheduled daily.
- Filename format: `jobs_YYYY_MM_DD.db`
- Schedule hour is configured in Settings (**UTC hour**).
- Automatic retention is capped by `backupMaxCount`.
- If today’s automatic backup already exists, JobOps skips creating a duplicate.

### Manual backups

- Triggered from Settings or `POST /api/backups`.
- Filename format: `jobs_manual_YYYY_MM_DD_HH_MM_SS.db`
- If a filename collision occurs, JobOps appends `_1`, `_2`, etc.
- Manual backups are **not** auto-deleted by automatic retention cleanup.

## Configure backups

Backup management is restricted to system admins. Normal workspace users cannot list, create, or delete backups.

In **Settings → Backup**:

1. Enable automatic backups.
2. Set backup hour (`0-23`, UTC).
3. Set max automatic backups to keep (`1-5`).
4. Save settings.

## API reference

```bash
# List backups + next scheduled run time
curl "http://localhost:3001/api/backups"
```

```bash
# Create a manual backup
curl -X POST "http://localhost:3001/api/backups"
```

```bash
# Delete a specific backup
curl -X DELETE "http://localhost:3001/api/backups/jobs_manual_2026_02_15_10_20_30.db"
```

```bash
# Update backup settings via Settings API
curl -X PATCH "http://localhost:3001/api/settings" \
  -H "content-type: application/json" \
  -d '{
    "backupEnabled": true,
    "backupHour": 2,
    "backupMaxCount": 5
  }'
```

## Restore workflow

To restore from a backup:

1. Stop JobOps.
2. Locate backup files in your data directory.
3. Copy the chosen backup over the main DB file (`jobs.db`).
4. Start JobOps.
5. Verify jobs/runs in the UI.

Example shell flow:

```bash
# Example only: adjust paths for your setup
cp /path/to/data/jobs_manual_2026_02_15_10_20_30.db /path/to/data/jobs.db
```

### Restore from an external filesystem backup

When the whole data directory is lost (host wipe, failed disk) but a
filesystem copy of `data/` exists elsewhere (backup disk, file-level
snapshot), restore `jobs.db` directly — no SQL import needed:

```bash
# 1. Verify the source is a healthy SQLite DB (read-only, before copying)
file /mnt/backup/job-ops-2026-10-06/data/jobs.db
# expected: SQLite 3.x database ...

sqlite3 /mnt/backup/job-ops-2026-10-06/data/jobs.db "PRAGMA integrity_check;"
# expected: ok

sqlite3 /mnt/backup/job-ops-2026-10-06/data/jobs.db "SELECT COUNT(*) FROM jobs;"
# expected: row count, e.g. 1835

# 2. Place the file first (Option A), then boot
mkdir -p ./data
cp /mnt/backup/job-ops-2026-10-06/data/jobs.db ./data/jobs.db
test -f ./data/jobs.db && echo "marker OK"

# 3. Start only job-ops (rxresume stack is independent)
docker compose up -d job-ops

# 4. Verify: migrations run, guard passes, health is 200, count matches
docker compose logs job-ops | grep -E "migrations complete|refusing to boot"
curl -f http://localhost:3005/health
sqlite3 ./data/jobs.db "SELECT COUNT(*) FROM jobs;"
```

Rules that make this work:

- The entrypoint refuses to boot when `./data/jobs.db` is missing (looks
  unmounted). Placing the file **before** first boot avoids the guard; the
  alternative (`ALLOW_FRESH_INIT=1`) forks an empty DB you must then
  overwrite, so prefer place-first.
- Migrations are idempotent — an older backup upgrades forward on boot,
  rows are preserved.
- Only `jobs.db` is required. `jwt-secret` regenerates on first login
  (forces re-login), and missing `pdfs/`, `job-documents/`,
  `visa-sponsors/` degrade to not-found downloads instead of boot failure.
- If the backup has `-wal`/`-shm` sidecars of non-zero size, copy all three
  files together; a 0-byte or absent WAL means single-file copy is safe.
- Docker volume archives (`*_pgdata.tar.gz`) are Postgres data for
  rxresume, not JobOps jobs — do not confuse them with `jobs.db`.

## Troubleshooting

### Backups are not running automatically

- Confirm `backupEnabled` is true.
- Confirm backup hour is set as intended (UTC, not local time).
- Verify the app process is running at scheduled time.

### `POST /api/backups` fails

- Confirm the data directory and `jobs.db` are writable/readable.
- Confirm `jobs.db` exists.
- In demo mode, manual backup creation is blocked.

### Cannot delete a backup

- Filename must match valid backup patterns.
- Invalid names and missing files return errors.

### Next scheduled time is null

- Automatic backups are currently disabled.

## Notes

- Backup cleanup applies only to automatic backups.
- Manual backups stay until you delete them.

## Related pages

- [Settings](../features/settings)
- [Self-Hosting](./self-hosting)
