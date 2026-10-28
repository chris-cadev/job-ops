# Design

## Context

See proposal.md Why. Live `./data/` is absent, so `getDataDir()` falls back to repo `./data`. Source `backups/job-ops-2026-10-06/data/jobs.db` is verified: SQLite 3.x, 30M, 1835 jobs, WAL 0 bytes, `integrity_check: ok`. Entrypoint guard (`docker-entrypoint.sh`) requires `jobs.db` marker; migrations (`orchestrator/src/server/db/migrate.ts`) are idempotent (`IF NOT EXISTS`, duplicate-column tolerant). `jwt-secret` auto-generates if missing (`orchestrator/src/server/auth/jwt.ts`).

## Goals / Non-Goals

**Goals:**
- Single-file restore with no forked DB and no manual SQL.
- Preserve 1835 rows through idempotent migration.

**Non-Goals:**
- rxresume Postgres restore, JDs volume, codex-home, visa-sponsors/pdfs backfill.
- Schema changes, API changes, auth migration.

## Decisions

- **Option A (place-then-boot) over containers-first with `ALLOW_FRESH_INIT=1`.** Rationale: avoids forking an empty DB that must then be overwritten; guard passes on first boot. Alternative B considered and rejected per user choice.
- **`job-ops` service only.** Rationale: it has no `depends_on` and owns `./data:/app/data`; rxresume stack is independent and out of scope.
- **Discard sidecars.** Rationale: `jwt-secret` regenerates (session reset only), missing `pdfs/`/`job-documents/` degrade to 404s on old downloads, new runs recreate dirs. Keeps the change to one file copy.
- **Read-only verify before copy (`file`, `sqlite3 integrity_check`, `SELECT COUNT(*)`)**. Rationale: cheap gate against corrupt source; no writes until verified.

## Risks / Trade-offs

- [Risk] Backup owned by `chris`, container writes as root → permission drift → Mitigation: `chown`/`chmod` check after copy, verify writability via migration run.
- [Risk] Schema drift (Oct-06 DB vs current code) → Mitigation: migrations are forward-only idempotent; abort on `Migration failed` exit 1 and inspect.
- [Risk] Dangling `pdf_path`/`storage_path` references → Mitigation: accepted; document as broken-link degradation, not boot failure.
- [Trade-off] Sessions reset (new `jwt-secret`) vs copying old secret → chosen reset for simplicity; re-login required.

## Migration Plan

- Deploy: `mkdir -p ./data`, copy `jobs.db`, `docker compose up -d job-ops`, verify `/health` + count + list.
- Rollback: stop `job-ops`, remove `./data/jobs.db` (no prior live data exists); re-restore on failure.

## Open Questions

- None blocking. Follow-up (docs update for `database-backups.md`) deferred to apply review.
