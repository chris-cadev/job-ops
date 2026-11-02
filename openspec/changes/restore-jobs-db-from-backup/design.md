# Design

## Context

See proposal.md Why. Current `./data/jobs.db` (Oct 28, 31M) fails every open with orphan index `sqlite_autoindex_pipeline_search_presets_2`; stale `-shm` present, `docker ps` empty. Backup `/mnt/backup/backups/job-ops-2026-10-06/data/jobs.db` (30M) reports `integrity_check: ok`. Compose mounts `./data:/app/data`; entrypoint `docker-entrypoint.sh` refuses boot without `jobs.db` marker and runs `migrate.ts` idempotently. `migrate.ts` uses `CREATE TABLE/INDEX IF NOT EXISTS`, so Oct-06 schema migrates forward.

## Goals / Non-Goals

**Goals:**
- Host-side file-only restore with pre- and post-copy verification and corrupt quarantine.
- Boot passes guard + migrations, jobs list returns 1835 rows.

**Non-Goals:**
- No forensic recovery of Oct 07-28 rows; no PDF/job-document backfill; no `models.db`/`jwt-secret`/`visa-sponsors` changes; no code changes.

## Decisions

- File-only copy (not SQLite `.recover`/dump) because backup is already `integrity_check: ok`; dump adds conversion risk. Alternative considered: `.dump | restore` — rejected, unnecessary.
- Quarantine via rename (`jobs.db.corrupt-<ts>`), not delete, to preserve forensics; direction host->container only, never copy forked DB to backup.
- Delete `-shm`/`-wal` with replacement; stale WAL would shadow new DB on next open.
- Keep current `visa-sponsors/` (Oct 28, all regions) over backup June UK-only; backup CSVs are stale. Keep current `jwt-secret` (root-owned) or let app regen if missing — do not restore backup secret.
- Verify after copy on the destination path (NTFS `umask=00` source may alter perms); `chown/chmod` to match `./data` before boot.

## Risks / Trade-offs

- [22-day staleness: Oct 06 backup loses Oct 07-28 writes] → Mitigation: state explicitly in completion; separate forensic change if needed.
- [NTFS->ext4 perm/owner drift, root-owned files in `./data`] → Mitigation: fix owner/perms after copy, verify readability from container UID.
- [Orphan index reappears after migrate] → Mitigation: `migrate.ts` uses `IF NOT EXISTS`; if boot still fails, keep quarantine and investigate migration, do not retry blindly.
- [Service autostart race before copy] → Mitigation: confirm `docker compose ps` stopped, copy while stopped, then start.

## Migration Plan

1. Stop `job-ops` (keep `rxresume-*` running unless they lock `./data`).
2. Pre-check backup: `file` + `integrity_check`.
3. Quarantine corrupt + remove sidecars.
4. Copy, fix perms, post-check.
5. Start `job-ops`, tail entrypoint/migrate logs, check `/health` + jobs count.
6. Rollback: stop, rename quarantine back, remove restored file, restart (still corrupt, but reversible).

## Open Questions

- None blocking specs/approach. Defer: whether to backfill `pdfs/`/`job-documents/` (53 + 4 files) in a follow-up.
