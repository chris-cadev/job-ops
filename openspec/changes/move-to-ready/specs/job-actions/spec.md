# Spec Delta

## Purpose

Bulk job actions move jobs between pipeline stages and report per-job outcomes so operators can act on failures without reading server logs.

## ADDED Requirements

### Requirement: Move-to-ready reports invalid RxResume credentials actionably
When PDF generation during `move_to_ready` fails because Reactive Resume rejects the configured API key (HTTP 401), the system SHALL return a per-job failure whose code identifies an upstream authorization problem and whose message names the RxResume API key and points at Settings.

#### Scenario: Single job fails on invalid RxResume key
- **WHEN** an operator runs `move_to_ready` for a `discovered` job and the resume import returns 401
- **THEN** the job result is `ok: false` with an authorization error code and a message stating the RxResume API key is invalid and where to update it

#### Scenario: Bulk run mixes auth failure with success
- **WHEN** an operator runs `move_to_ready` for several jobs and one fails with 401 while another succeeds
- **THEN** the response reports the correct succeeded/failed counts and only the failed job carries the invalid-key message

### Requirement: Action stream preserves actionable per-job errors
The `move_to_ready` SSE stream SHALL carry the same per-job error code and message in `progress` and `completed` events as the non-streaming action endpoint, without changing event shapes.

#### Scenario: Streamed bulk failure keeps error detail
- **WHEN** an operator runs `move_to_ready` via `/actions/stream` and a job fails with 401
- **THEN** the `progress` event for that job and the final `completed` event both include the authorization code and invalid-key message

### Requirement: Bulk-action UI surfaces the recovery action
After a bulk `move_to_ready` run with invalid-key failures, the UI SHALL display the invalid-key message with an affordance to reach Settings, and SHALL keep the failed jobs selected for retry.

#### Scenario: Operator sees what to fix after bulk failure
- **WHEN** a bulk `move_to_ready` run completes with an invalid-key failure
- **THEN** the UI shows the invalid-key message plus a way to open Settings and retains the failed job in the selection

### Requirement: Non-auth move-to-ready failures keep existing behavior
Failures unrelated to RxResume authorization (tailoring/LLM errors, renderer outages, status preconditions, conflicts) SHALL keep their current codes, messages, and counts.

#### Scenario: Status precondition still rejected as before
- **WHEN** an operator runs `move_to_ready` for a job that is not `discovered`
- **THEN** the job fails with the existing not-movable validation error and no invalid-key message appears
