---
id: common-problems
title: Common Problems
description: Quick fixes for the most frequent setup and runtime issues.
sidebar_position: 1
---

## Docs site not loading at `/docs`

- Confirm docs build exists:

```bash
npm --workspace docs-site run build
```

- In production, ensure container includes docs build artifact.

## Deep links under `/docs/*` return 404

- Confirm Express is serving docs static mount before app SPA fallback.
- Confirm docs base URL is `/docs/` in `docs-site/docusaurus.config.ts`.

## Gmail OAuth callback fails

- Verify `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`.
- Ensure authorized redirect URI exactly matches deployment callback URL.

## No job scoring or AI inference

- Validate `LLM_API_KEY` and provider settings.
- Check settings page and API connectivity.

## Older jobs look expired or stale

- Run the pipeline again before reviewing or applying.
- Existing discovered jobs are not automatically refreshed in the background.
- A new run fetches current listings so you can work from fresher results.

## Codex sign-in shows device-code authorization error

- Symptom: UI shows:
  - `Enable device code authorization for Codex in ChatGPT Security Settings, then run "codex login --device-auth" again`
- Fix:
  - Enable device-code authorization in ChatGPT Security Settings and retry sign-in
- Full guide:
  - [Codex Authentication](/docs/next/getting-started/codex-auth)

## Resume tailoring or scoring says the model does not exist

- Root cause: the selected provider and model do not match.
- Open **Settings -> Model** and check both the provider and the current model preview.
- If you recently switched providers, leave the model fields blank to use the provider default, or select a provider-compatible model and save again.
- For `openai`, JobOps defaults to `gpt-5.4-mini` when the model field is blank.
- For `glm`, JobOps defaults to `glm-5.1` and `https://api.z.ai/api/paas/v4` when the model/base URL fields are blank.
- For `gemini`, JobOps defaults to `google/gemini-3-flash-preview` when the model field is blank.

## PDF generation fails

- Verify RxResume credentials.
- Confirm selected base resume exists and is accessible.

## UKVisaJobs runs fail

- Re-authenticate by removing cached auth file or forcing refresh.
- Verify extractor credentials and API response behavior.

## After a reboot: login fails or setup asks to onboard again

- Cause: the container autostarted before the host file share was ready,
  so `/app/data` looked empty and the server initialized a forked database.
  A container `restart` cannot fix this: restart keeps the same mount view.
  Recovery direction is host -> container only.
- Confirm the fork: compare sizes and check the bootstrap flag:

```bash
ls -la data/jobs.db
docker exec job-seeking-job-ops-1 ls -la /app/data/
curl -s http://127.0.0.1:3005/api/auth/bootstrap-status
```

- If the container DB is small/fresh while the host DB is large, recover:

```bash
docker compose stop job-ops
docker compose down
docker compose up -d
curl -s http://127.0.0.1:3005/api/auth/bootstrap-status
```

- The last command must report `setupRequired: false`. `down`/`up` recreates
  the container so the bind mount re-resolves; `restart` alone never does.
- The entrypoint now refuses to boot on an empty data dir (startup guard).
  If logs say the data dir looks unmounted, wait one minute and check
  `docker logs job-seeking-job-ops-1`; the restart policy retries automatically.

## Genuine first install on an empty data dir

- The startup guard blocks fresh init unless you explicitly opt in.
  One-shot procedure (remove the variable afterwards):

```bash
ALLOW_FRESH_INIT=1 docker compose up -d --build job-ops
docker logs job-seeking-job-ops-1
# after first boot succeeds, remove the variable and recreate:
docker compose up -d --build job-ops
```

- Note: a locally built image is required for the guard to take effect,
  because the guard lives in `docker-entrypoint.sh` baked at build time.
  `docker compose up` without `--build` keeps running the pulled image.
- Never copy a forked container DB back to the host `data/` directory.
