/**
 * Scheduled pipeline runner — runs a saved search pipeline on a cron schedule.
 *
 * Reads config from env vars; no-ops if not configured.
 * On startup, runs only if no *scheduled* run covered the previous tick
 * (manual "Run jobs" clicks don't count). Uses the in-process scheduler
 * (no separate cron or Docker service needed).
 *
 * Cadence is `SCHEDULED_PIPELINE_CRON` (5-field cron, e.g. `0 7 * * *`
 * daily, or 7am every odd day-of-month for a two-day rhythm). Note: a
 * step in day-of-month is month-anchored (1,3,5…31, then 1 again), so a
 * 31-day month followed by the 1st yields a 1-day gap. Without
 * `SCHEDULED_PIPELINE_CRON`, falls back to the legacy daily
 * `SCHEDULED_PIPELINE_HOUR`.
 *
 * ponytail: TZ-aware scheduling via croner (validates IANA zone via Intl).
 * ponytail: In-process — no separate Docker service, no network hop.
 * ponytail: Uses pipeline_runs config-snapshot trigger tag as the
 *   "did the schedule run?" state machine — no DB migration.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import * as pipelineSearchPresetsRepo from "@server/repositories/pipeline-search-presets";
import { ensurePipelineSearchTerms } from "@server/services/pipeline-search-terms";
import { createLocationIntent } from "@shared/location-intelligence.js";
import type { PipelineConfig, PipelineRun } from "@shared/types";
import { Cron } from "croner";

const ENV_PREFIX = "SCHEDULED_PIPELINE";

/** Max setTimeout delay (~24.8 days); longer waits are re-armed. */
const MAX_TIMEOUT_MS = 2_147_483_647;

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
}

const state: SchedulerState = { timer: null };

function clearScheduledRun(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/**
 * Resolve the active schedule. `SCHEDULED_PIPELINE_CRON` wins; otherwise the
 * legacy daily `SCHEDULED_PIPELINE_HOUR` is translated to cron.
 */
export function resolveScheduledCron(env: NodeJS.ProcessEnv = process.env): {
  cron: string;
  timezone: string;
} {
  const timezone = env[`${ENV_PREFIX}_TIMEZONE`] ?? "America/Tijuana";
  const raw = env[`${ENV_PREFIX}_CRON`]?.trim();
  if (raw) return { cron: raw, timezone };
  const hour = Number(env[`${ENV_PREFIX}_HOUR`] ?? "7");
  const safeHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 7;
  return { cron: `0 ${safeHour} * * *`, timezone };
}

function createScheduleCron(cron: string, timezone: string): Cron {
  // croner silently falls back on unknown zones — fail loudly instead.
  new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  return new Cron(cron, { timezone });
}

export function getNextScheduledTick(args: {
  cron: string;
  timezone: string;
  from?: Date;
}): Date {
  const next = createScheduleCron(args.cron, args.timezone).nextRun(args.from);
  if (!next) throw new Error(`No next run for schedule "${args.cron}"`);
  return next;
}

export function getPreviousScheduledTick(args: {
  cron: string;
  timezone: string;
  from?: Date;
}): Date | null {
  const [previous] = createScheduleCron(args.cron, args.timezone).previousRuns(
    1,
    args.from,
  );
  return previous ?? null;
}

/**
 * Startup decision: run only when no scheduled run covers the previous tick.
 * Manual runs are invisible here (caller passes the latest *scheduled* run).
 */
export function shouldRunScheduledOnStartup(args: {
  lastScheduledRun: PipelineRun | null;
  previousTick: Date | null;
}): { run: boolean; reason: string } {
  const { lastScheduledRun, previousTick } = args;
  if (!previousTick) return { run: true, reason: "no-previous-tick" };
  if (!lastScheduledRun) return { run: true, reason: "no-scheduled-run-yet" };
  if (new Date(lastScheduledRun.startedAt) < previousTick) {
    return { run: true, reason: "missed-tick" };
  }
  if (lastScheduledRun.status === "failed") {
    return { run: true, reason: "retry-failed" };
  }
  if (lastScheduledRun.status === "running") {
    // Stale "running" row means the process died mid-run before restart.
    return { run: true, reason: "retry-interrupted" };
  }
  return { run: false, reason: "already-ran" };
}

async function executeScheduledRun(): Promise<void> {
  const savedSearchName = process.env[`${ENV_PREFIX}_SEARCH_NAME`];
  if (!savedSearchName) return;

  logger.info("Starting scheduled pipeline run", { savedSearchName });

  const preset =
    await pipelineSearchPresetsRepo.findPipelineSearchPresetByName(
      savedSearchName,
    );
  if (!preset) {
    logger.error("Scheduled saved search not found — skipping run", {
      name: savedSearchName,
    });
    return;
  }

  const cfg = preset.config;
  const locationIntent = createLocationIntent({
    selectedCountry: cfg.country,
    cityLocations: cfg.cityLocations,
    workplaceTypes: cfg.workplaceTypes,
    geoScope: cfg.searchScope,
    matchStrictness: cfg.matchStrictness,
  });

  // Persist the saved search's search terms into settings so the pipeline
  // uses them instead of falling back to generated terms.
  await ensurePipelineSearchTerms({ requestedSearchTerms: cfg.searchTerms });

  const pipelineConfig: Partial<PipelineConfig> = {
    topN: cfg.topN,
    minSuitabilityScore: cfg.minSuitabilityScore,
    sources: cfg.sources,
    locationIntent,
  };

  const result = await runPipeline(pipelineConfig, { trigger: "scheduled" });
  if (result.success) {
    logger.info("Scheduled pipeline run completed", {
      jobsDiscovered: result.jobsDiscovered,
      jobsProcessed: result.jobsProcessed,
    });
  } else {
    logger.error("Scheduled pipeline run failed", {
      error: result.error,
      jobsDiscovered: result.jobsDiscovered,
    });
  }
}

async function checkAndRunOnStartup(schedule: {
  cron: string;
  timezone: string;
}): Promise<void> {
  const previousTick = getPreviousScheduledTick(schedule);
  const lastScheduledRun = await pipelineRepo.getLatestScheduledPipelineRun();
  const decision = shouldRunScheduledOnStartup({
    lastScheduledRun,
    previousTick,
  });
  if (!decision.run) {
    logger.info("Skipping startup run — scheduled run already ran", {
      reason: decision.reason,
      runId: lastScheduledRun?.id,
      status: lastScheduledRun?.status,
    });
    return;
  }
  logger.info("Running scheduled pipeline on startup", {
    reason: decision.reason,
  });
  await executeScheduledRun();
}

function scheduleNextRun(schedule: { cron: string; timezone: string }): void {
  clearScheduledRun();

  let nextRun: Date;
  try {
    nextRun = getNextScheduledTick(schedule);
  } catch (error) {
    logger.error("Invalid scheduled pipeline cron — scheduler disabled", {
      cron: schedule.cron,
      timezone: schedule.timezone,
      error,
    });
    return;
  }
  const delay = nextRun.getTime() - Date.now();

  logger.info("Scheduled pipeline run", {
    nextRun: nextRun.toISOString(),
    cron: schedule.cron,
    timeZone: schedule.timezone,
  });

  // ponytail: clamp to max setTimeout delay; distant ticks re-arm instead of overflowing.
  state.timer = setTimeout(
    async () => {
      if (nextRun.getTime() - Date.now() > 0) {
        scheduleNextRun(schedule);
        return;
      }
      await executeScheduledRun();
      scheduleNextRun(schedule);
    },
    Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS),
  );
}

/**
 * Initialize the scheduled pipeline runner.
 * Call once at server startup. No-ops if SCHEDULED_PIPELINE_SEARCH_NAME is not set.
 */
export async function initializeScheduledPipelineRun(): Promise<void> {
  const savedSearchName = process.env[`${ENV_PREFIX}_SEARCH_NAME`]?.trim();
  const tenantId = process.env[`${ENV_PREFIX}_TENANT_ID`]?.trim();
  const userId = process.env[`${ENV_PREFIX}_USER_ID`]?.trim();

  if (!savedSearchName || !tenantId || !userId) {
    logger.info("Scheduled pipeline not configured — skipping", {
      searchName: !!savedSearchName,
      tenantId: !!tenantId,
      userId: !!userId,
    });
    return;
  }

  let schedule: { cron: string; timezone: string };
  try {
    schedule = resolveScheduledCron(process.env);
    getNextScheduledTick(schedule);
  } catch (error) {
    logger.error("Invalid scheduled pipeline cron — scheduler disabled", {
      cron: process.env[`${ENV_PREFIX}_CRON`],
      error,
    });
    return;
  }

  logger.info("Initializing scheduled pipeline runner", {
    savedSearchName,
    tenantId,
    userId,
    cron: schedule.cron,
    timezone: schedule.timezone,
  });

  // Wrap all operations in the correct tenant/user context.
  await runWithRequestContext({ tenantId, userId }, async () => {
    await checkAndRunOnStartup(schedule);
    scheduleNextRun(schedule);
  });
}
