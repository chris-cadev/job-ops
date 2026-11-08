# Spec Delta

## Purpose

CV tailoring eligibility gated by the scheduled-run filtering pile, so external publish spend follows survivors instead of all discovered jobs.

## ADDED Requirements

### Requirement: Only filtering survivors qualify for CV publish

The system SHALL consider only jobs that passed the current run's full filtering pile (target-filter not-skipped, suitability-scored, selected by score threshold and topN slice) as eligible for external CV generation and publish.

#### Scenario: Filtered-out job gets no CV run

- **WHEN** a scheduled run completes filtering and a `discovered` job was excluded (target-filter `skipped`, below `minSuitabilityScore`, or outside `topN`)
- **THEN** no ingest, generate, publish, note, or PDF export runs for that job in that run

#### Scenario: Survivor gets full publish tail

- **WHEN** a job is in the run's survivor set and has a non-empty job description
- **THEN** the run enriches its JD, generates the CV, publishes it, upserts one `Tailored CVs (cv-tailoring)` note line with the Doc URL, exports the Doc to PDF, uploads it, and ensures the job is `ready`

### Requirement: Empty survivor set means no CV work

When the survivor set is empty, the CV phase SHALL report zero attempts and perform zero per-job runs.

#### Scenario: No survivors

- **WHEN** filtering selects zero jobs in a run
- **THEN** the CV phase reports `attempted: 0, succeeded: 0, failed: 0, skipped: 0` and invokes no generation

### Requirement: Scoped runs stay idempotent and non-blocking

Each survivor run SHALL be idempotent per job (reuse the existing Doc URL line unless forced) and SHALL never fail the pipeline; per-job outcomes are collected as `succeeded/failed/skipped` counts.

#### Scenario: Survivor already has a Doc line

- **WHEN** a survivor's note already contains its Doc URL line and the run is not forced
- **THEN** generation is skipped and the existing Doc URL is reused for export/upload

#### Scenario: Single survivor fails

- **WHEN** one survivor's ingest, generate, publish, or export fails
- **THEN** that job is counted as failed with its error logged, remaining survivors still run, and the pipeline completes

### Requirement: No backfill of pre-existing ready jobs

Jobs that were already `ready` before the run and are not in the run's survivor set SHALL NOT be touched by the scoped CV phase (no note, no PDF overwrite).

#### Scenario: Old ready job outside survivors

- **WHEN** a job became `ready` in an earlier run and is not selected in the current run
- **THEN** the current run's CV phase performs no work for that job
