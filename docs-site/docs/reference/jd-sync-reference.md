---
id: jd-sync-reference
title: jd-sync Reference
description: Command, configuration, and behavior reference for the jd-sync job-description export.
sidebar_position: 3
---

Reference page for the `jd-sync` command. For step-by-step use, see
[Export Job Descriptions (jd-sync)](../getting-started/jd-sync).

## Command

| npm script | Resolves to |
|-------------|-------------|
| `npm run jd-sync` | `tsx src/server/cli/jd-sync.ts` |

Run from the orchestrator workspace. In the container the working directory is
`/app/orchestrator`.

## Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| `JD_OUTPUT_DIR` | `/app/jds` | Output directory for exported `.md` files |

The default `docker-compose.yml` bind-mounts the container's `/app/jds` to
`../cv-tailoring/software-engineer/00-source-reference` on the host.

## Behavior

- **Selection**: the newest jobs in `discovered` status that have a non-null job
  description, up to 500.
- **Tenant scoping**: jobs are read from the active tenant. The standalone CLI runs without
  a request context, so it reads the `tenant_default` tenant. Jobs stored under a private
  per-user workspace are not included.
- **Filename**: `JD - {title} - {employer}.md`, with characters invalid for file paths
  removed.
- **Idempotent**: files that already exist are skipped; re-running only writes files for new
  jobs.
- **Exit codes**: `0` when all writes succeed, `1` when any write fails or a fatal error
  occurs.

## Pipeline side effect

Pipeline runs also write job descriptions into the same `JD_OUTPUT_DIR` as a side effect.
Those files use a different naming scheme — `{employer}_{title}.md` (lowercased slug, no
`JD - ` prefix).

## Related pages

- [Export Job Descriptions (jd-sync)](../getting-started/jd-sync)
- [Self-Hosting (Docker Compose)](../getting-started/self-hosting)
- [Pipeline Run](../features/pipeline-run)