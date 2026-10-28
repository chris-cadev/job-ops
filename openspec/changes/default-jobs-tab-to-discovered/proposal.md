# Proposal

## Why

The Jobs section lands on the Ready tab, but the daily workflow starts with newly discovered jobs. Making Discovered the default removes a click on every visit and matches the tab strip's own visual order.

## What Changes

- `/` redirects to `/jobs/discovered` instead of `/jobs/ready`.
- Missing/invalid tab in the URL falls back to `discovered` instead of `ready`.
- Onboarding completion lands on `/jobs/discovered` instead of `/jobs/ready`.
- No change to tab order or membership: Discovered | Ready | Applied | All Jobs stays as-is (rendered from the existing `tabs` array; the stale 3-tab view in the running container is fixed by rebuilding the client, not by this change).

## Capabilities

### New Capabilities

- `jobs-tabs`: The Jobs section tab strip — tab order, labels, default selected tab, and URL deep-linking behavior for `ready`, `discovered`, `applied`, and `all`.

### Modified Capabilities

- None (no existing spec covers Jobs navigation; `database-restore` is unrelated).

## Impact

- Affected: `orchestrator/src/client/App.tsx` (root redirect), `orchestrator/src/client/pages/OrchestratorPage.tsx` (default + invalid-tab fallback), `orchestrator/src/client/pages/OnboardingPage.tsx` (completion landing).
- No API, schema, migration, or dependency changes. Existing `/jobs/ready...` deep links keep working.
- Client rebuild + container refresh required to see the result (prebuilt client served from the image).
