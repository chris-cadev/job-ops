# Spec Delta

## ADDED Requirements

### Requirement: Corrupt current DB is quarantined before replace
The system SHALL preserve the corrupt `./data/jobs.db` under a timestamped quarantine name before replacement, and stale `-shm`/`-wal` files SHALL be removed with it.

#### Scenario: Quarantine corrupt DB
- **WHEN** operator replaces a corrupt `./data/jobs.db` that fails `integrity_check`
- **THEN** the original file is renamed to `./data/jobs.db.corrupt-<timestamp>` and `jobs.db-shm`/`jobs.db-wal` are deleted, and no corrupt file is copied back to backup storage

### Requirement: Restored DB is verified after copy
The system SHALL accept the restored `./data/jobs.db` only after post-copy `file` reports SQLite and `PRAGMA integrity_check` returns `ok`.

#### Scenario: Post-copy verification
- **WHEN** the 10-06 backup `jobs.db` is copied to `./data/jobs.db`
- **THEN** verification passes and the entrypoint guard finds the marker, migrations run idempotently, and the jobs list returns 1835 rows

#### Scenario: Failed verification blocks boot
- **WHEN** post-copy verification fails
- **THEN** the operator does not start `job-ops` and keeps the quarantine for forensics
