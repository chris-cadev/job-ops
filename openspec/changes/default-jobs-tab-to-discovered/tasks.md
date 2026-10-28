# Tasks

## 1. Change the default landing to Discovered

- [x] 1.1 Redirect app root to Discovered and verify `App.tsx` maps `/` to `/jobs/discovered`
- [x] 1.2 Fall back to Discovered for missing/invalid tabs and verify `OrchestratorPage.tsx` defaults and redirects use `discovered`
- [x] 1.3 Land onboarding completion on Discovered and verify `OnboardingPage.tsx` navigates to `/jobs/discovered`
- [x] 1.4 Point remaining default entries at Discovered and verify sidebar Jobs link, sign-in default redirect, and no-window fallback use `/jobs/discovered`

## 2. Verify code correctness

- [x] 2.1 Run the orchestrator page and routing tests and verify `OrchestratorPage.test.tsx` (and any App routing tests) pass
- [x] 2.2 Run typecheck and client build and verify `check:types` passes and `build:client` succeeds

## 3. Verify in the running container

- [x] 3.1 Rebuild the image, restart `job-ops`, and verify `/` lands on `/jobs/discovered` with tabs Discovered | Ready | Applied | All Jobs and correct count badges
- [x] 3.2 Verify deep links still work and verify `/jobs/ready`, `/jobs/applied`, `/jobs/all` (with job id and query params) select the requested tab
