# Spec Delta

## Purpose

Defines the Jobs section tab strip so users land on newly discovered jobs first while every tab stays deep-linkable in a stable order.

## ADDED Requirements

### Requirement: Discovered is the default Jobs tab

The system SHALL select the Discovered tab when the URL has no tab or an invalid tab, and the app root SHALL redirect to the Discovered tab.

#### Scenario: App root lands on Discovered

- **WHEN** the user visits `/`
- **THEN** the app navigates to `/jobs/discovered`

#### Scenario: Missing tab falls back to Discovered

- **WHEN** the user visits a Jobs URL without a valid tab segment
- **THEN** the Discovered tab is selected

#### Scenario: Explicit tab links keep working

- **WHEN** the user visits `/jobs/ready`, `/jobs/applied`, or `/jobs/all` (with or without a job id and query params)
- **THEN** the requested tab is selected and search params are preserved

### Requirement: Jobs tab strip order is stable

The system SHALL render the Jobs tabs in the order Discovered, Ready, Applied, All Jobs, each showing its job count badge only when the count is greater than zero.

#### Scenario: Tab order

- **WHEN** the user views the Jobs section
- **THEN** tabs appear left-to-right as Discovered, Ready, Applied, All Jobs

### Requirement: App entry points land on Discovered

The system SHALL use the Discovered tab for the sidebar Jobs link, the post-sign-in default redirect, and the no-window path fallback.

#### Scenario: Sidebar Jobs link

- **WHEN** the user clicks Jobs in the sidebar
- **THEN** the app navigates to `/jobs/discovered`

#### Scenario: Post-sign-in default

- **WHEN** the user signs in without a `next` target (or with a sign-in `next` target)
- **THEN** the app navigates to `/jobs/discovered`

#### Scenario: No-window fallback

- **WHEN** the current app path is resolved without a window object
- **THEN** the fallback path is `/jobs/discovered`

#### Scenario: Onboarding completion lands on Discovered

- **WHEN** the user completes onboarding
- **THEN** the app navigates to `/jobs/discovered`
