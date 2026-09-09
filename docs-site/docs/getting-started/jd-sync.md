---
id: jd-sync
title: Export Job Descriptions (jd-sync)
description: How to export job descriptions from JobOps as markdown files using the jd-sync command.
sidebar_position: 5
---

`jd-sync` writes job descriptions from the JobOps database to markdown files so you can use
them outside the app — for example as a CV-tailoring corpus. This page is a how-to guide;
for exact command behavior, outputs, and selection rules, see the
[jd-sync reference](../reference/jd-sync-reference).

## Before you start

- The Docker Compose stack is running (`docker compose up -d`).
- The database contains jobs in `discovered` status with a job description.

## Export from the container

1. From the repository root, run:

   ```bash
   docker compose exec job-ops npm run jd-sync
   ```

2. Wait for the summary line:

   ```text
   JD sync: 200 written, 300 skipped, 0 errors
   ```

3. Open the host folder where the files are written. With the default compose file this is
   `../cv-tailoring/software-engineer/00-source-reference` (relative to the repo), which is
   mounted from the container's `/app/jds`.

## Export to a different directory

Pass `JD_OUTPUT_DIR` inline:

```bash
docker compose exec -e JD_OUTPUT_DIR=/app/data/jds job-ops npm run jd-sync
```

Or set `JD_OUTPUT_DIR` in your `.env` and restart the stack, then run the normal command.

## Run locally (outside Docker)

```bash
cd orchestrator
npm run jd-sync
```

## Common problems

### No files are written

- Confirm jobs exist in `discovered` status and have a job description.
- Confirm the exported tenant matches where the jobs were saved (see the
  [reference](../reference/jd-sync-reference) for tenant behavior).
- Confirm the output directory is writable.

### Files for existing jobs are skipped

This is expected. `jd-sync` skips files that already exist, so re-running only writes files
for newly discovered jobs.

## Related pages

- [jd-sync reference](../reference/jd-sync-reference)
- [Self-Hosting (Docker Compose)](./self-hosting)
- [Database Backups](./database-backups)