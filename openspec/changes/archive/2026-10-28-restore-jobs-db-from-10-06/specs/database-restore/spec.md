# Spec Delta

## Purpose

Lets operators restore the primary SQLite database from a verified filesystem backup so historical job rows survive host wipes and volume loss.

## ADDED Requirements

### Requirement: Restore jobs.db from verified backup

The system SHALL boot with historical job rows intact when `./data/jobs.db` is replaced by a verified backup copy before container start.

#### Scenario: Boot with restored backup

- **WHEN** operator copies the 10-06 `jobs.db` to `./data/jobs.db` and starts `job-ops`
- **THEN** the entrypoint guard passes, migrations run idempotently, and the jobs list returns the backed-up row count

#### Scenario: Backup integrity pre-check

- **WHEN** operator validates the source file with file-type and integrity checks
- **THEN** only a SQLite database reporting `integrity_check: ok` is accepted as restore source

### Requirement: Discarded sidecars do not block boot

The system SHALL boot and serve job rows when only `jobs.db` is present without `jwt-secret`, `pdfs/`, `job-documents/`, or `visa-sponsors/`.

#### Scenario: Minimal data dir

- **WHEN** `./data/` contains only `jobs.db`
- **THEN** the app generates a fresh `jwt-secret`, creates missing dirs on demand, and job reads succeed while missing file downloads return not-found
