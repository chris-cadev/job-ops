---
id: multi-select-and-bulk-actions
title: Multi-Select and Bulk Actions
description: Select multiple jobs with mouse or keyboard and run bulk actions like Move to Ready, Skip, or Recalculate match.
sidebar_position: 5
---

Multi-select lets you process many jobs at once instead of repeating the same action one-by-one.

## Why this exists

When you run discovery at scale, you often need to:

- skip batches of low-priority jobs
- move a shortlist to Ready quickly
- recalculate fit scores after settings/profile changes

Bulk actions reduce repetitive clicks, keep momentum high, and make triage runs faster.

## Mouse workflow

### Select jobs

1. Use the checkbox on each row to include/exclude a job.
2. Use **Select all filtered** to select jobs currently visible in the active filtered list.
3. Check the selected count in the list header.

### Run bulk actions

When one or more jobs are selected, a floating action bar appears at the bottom.

Available actions depend on selected job statuses:

- **Move to Ready**
- **Skip selected**
- **Recalculate match**
- **Clear** (clears selection)

## Keyboard workflow

Use shortcuts from the Jobs page:

- `x`: toggle select on the currently focused job
- `Esc`: clear current selection
- `r`: in `discovered`, move to Ready

`r` behavior with selection:

- if you have a multi-selection active, `r` runs the bulk **Move to Ready** action
- if nothing is selected, `r` runs move-to-ready for the single current job

## Important limits and behavior

- Bulk actions are capped at **100 jobs per run**.
- `Select all filtered` also respects the same 100-job cap.
- Selection resets when you switch tabs.
- If jobs disappear from the active filtered list, they are removed from selection automatically.

## Common problems

### Move to Ready reports an invalid Reactive Resume API key

Bulk **Move to Ready** does more than flip a status: it tailors each job and then renders a resume PDF through Reactive Resume, and that render step needs a valid Reactive Resume API key.

Symptom: the run finishes with `N succeeded, M failed`, and the failure reads `Reactive Resume v5 API key is invalid. Update the API key and try again.` Failed jobs stay selected so you can retry immediately after fixing the key.

To recover:

1. In Reactive Resume, generate a new API key.
2. In JobOps, open **Settings → Integrations → Reactive Resume** (or follow the **Open Settings** link in the failure message) and paste the key into the API key field. Alternatively, set `RXRESUME_API_KEY` in the environment.
3. Save, then retry **Move to Ready** — the failed jobs are still selected.

This usually happens when the stored key was rotated or deleted in Reactive Resume, or when it belongs to a different Reactive Resume database (for example after restoring `jobs.db` from a backup without its matching Reactive Resume data).

### Move to Ready succeeds without a PDF when no key is set

This is different from the invalid-key failure above, and it is expected behavior — not an error.

When **no** Reactive Resume API key is configured at all, **Move to Ready** still tailors each job and moves it to Ready, but skips the PDF render. The success message says the jobs moved to Ready **without a PDF**, and the Ready view shows the Resume PDF kit item as Missing instead of a download button.

To get PDFs later:

1. Configure a key in **Settings → Integrations → Reactive Resume** (or set `RXRESUME_API_KEY` in the environment).
2. Use **Generate PDF** on the job (or wait for automatic regeneration) — the tailored content is already there, so only the render runs.

If a key is configured but rejected, you get the invalid-key failure above instead of this fallback — a silent skip would hide the misconfiguration.

## Related pages

- [Keyboard Shortcuts](./keyboard-shortcuts)
- [Orchestrator](./orchestrator)
- [Find Jobs and Apply Workflow](../workflows/find-jobs-and-apply-workflow)
