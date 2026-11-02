# Spec Delta

## Purpose

Jobs reach the ready stage through tailoring plus resume rendering, and operators who render CVs outside Reactive Resume need the stage transition to work even when no RxResume key is configured.

## ADDED Requirements

### Requirement: Move-to-ready skips rendering when no RxResume key is set
When no Reactive Resume API key is configured, `move_to_ready` SHALL still run tailoring and then mark the job `ready` without a PDF instead of failing.

#### Scenario: Single job with no key configured
- **WHEN** an operator runs `move_to_ready` for a `discovered` job and no RxResume API key is configured
- **THEN** the result is `ok: true` with status `ready`, tailored content present, and no PDF path

#### Scenario: Bulk run with no key configured
- **WHEN** an operator runs bulk `move_to_ready` with no key configured
- **THEN** all eligible jobs succeed with `ready` status and none report failures

### Requirement: Configured-but-invalid keys still fail actionably
A configured key that Reactive Resume rejects SHALL still produce the actionable authorization failure, never a silent skip to ready-without-PDF.

#### Scenario: Invalid key is not treated as missing
- **WHEN** an operator runs `move_to_ready` with a configured key that returns 401
- **THEN** the job result is `ok: false` with the authorization code and invalid-key message

### Requirement: Pipeline and manual-create flows inherit the fallback
Pipeline auto-processing and manual-job auto-processing SHALL apply the same skip-render fallback when no key is configured.

#### Scenario: Pipeline run with no key configured
- **WHEN** the pipeline auto-processes a job with no RxResume key configured
- **THEN** the job completes tailoring and reaches `ready` without a PDF instead of being recorded as failed

### Requirement: Explicit PDF generation still fails without a key
An explicit generate-PDF request with no key configured SHALL fail actionably, since there is no status transition to fall back to.

#### Scenario: Generate-PDF click with no key configured
- **WHEN** an operator explicitly requests PDF generation with no key configured
- **THEN** the request fails with a not-configured message and the job status is unchanged

### Requirement: Ready jobs without a PDF stay usable
Jobs that reach `ready` without a PDF SHALL list, display, and flow through apply normally, with PDF affordances hidden rather than broken, and SHALL gain a PDF through normal generation once a key is configured.

#### Scenario: Ready tab with a PDF-less job
- **WHEN** an operator views a `ready` job that has no PDF path
- **THEN** the job displays without PDF download affordances and without errors

#### Scenario: Late key configuration enables later rendering
- **WHEN** a key is configured after a job reached `ready` without a PDF
- **THEN** normal PDF generation produces a PDF for that job
