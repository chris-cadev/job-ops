# Spec Delta

## Purpose

Automatic scheduled pipeline runs keep the saved-search results fresh without manual triggers, honoring a cron cadence in the configured timezone with safe startup and per-tick behavior.

## ADDED Requirements

### Requirement: Thu through Mon thrice-daily cadence
The system SHALL run the configured saved search at 07:00, 13:00, and 19:00 America/Tijuana on Thu, Fri, Sat, Sun, and Mon, with no scheduled runs on Tue or Wed.

#### Scenario: Morning run fires on an active day
- **WHEN** the time reaches 07:00 America/Tijuana on a Thu/ Fri/ Sat/ Sun/ Mon
- **THEN** the system starts a scheduled pipeline run for the configured saved search

#### Scenario: Midday and evening runs fire on an active day
- **WHEN** the time reaches 13:00 or 19:00 America/Tijuana on an active day
- **THEN** the system starts a scheduled pipeline run for the configured saved search

#### Scenario: Off days stay quiet
- **WHEN** the day is Tuesday or Wednesday
- **THEN** the system starts no scheduled runs that day

### Requirement: Timezone-aware scheduling
The system SHALL interpret the cron expression in the configured timezone (default America/Tijuana) so wall-clock times hold across UTC offset changes.

#### Scenario: Tijuana wall-clock stability
- **WHEN** the cron is `0 7,13,19 * * 4,5,6,0,1` with timezone America/Tijuana
- **THEN** ticks resolve to 07:00/13:00/19:00 Tijuana local time regardless of the container OS timezone

### Requirement: Startup catch-up stays non-cumulative
The system SHALL run at most one catch-up run on startup when ticks were missed (e.g. across the Tue/Wed gap or a multi-day outage), and SHALL NOT backfill each missed tick.

#### Scenario: Boot after the off-days gap
- **WHEN** the server boots Thursday after no runs since Monday 19:00 and the last scheduled run predates the previous tick
- **THEN** the system runs exactly one scheduled catch-up run

#### Scenario: Boot with nothing missed
- **WHEN** the server boots and the latest scheduled run already covers the previous tick
- **THEN** the system starts no catch-up run

### Requirement: Tick single-flight per window
The system SHALL start a tick run only when the current window is not already covered by a scheduled run that started after the previous tick (completed/cancelled/running block duplicates; failed allows retry).

#### Scenario: Duplicate tick is skipped
- **WHEN** a scheduled run already completed after the previous tick for the current window
- **THEN** the tick is skipped with reason already-ran-this-window

#### Scenario: Failed run is retried on tick
- **WHEN** the covering run for the window failed
- **THEN** the tick runs again with reason retry-failed-this-window
