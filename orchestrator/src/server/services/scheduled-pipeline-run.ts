/**
 * Scheduled pipeline runner — runs a saved search pipeline daily at a local time.
 *
 * Reads config from env vars; no-ops if not configured.
 * On startup, checks if the pipeline already ran today (or failed and needs retry).
 * Uses the in-process scheduler (no separate cron or Docker service needed).
 *
 * ponytail: TZ-aware scheduling via synchronous process.env.TZ swap.
 * ponytail: In-process — no separate Docker service, no network hop.
 * ponytail: Uses pipeline_runs table as the "did we run today?" state machine.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import * as pipelineSearchPresetsRepo from "@server/repositories/pipeline-search-presets";
import { ensurePipelineSearchTerms } from "@server/services/pipeline-search-terms";
import { createLocationIntent } from "@shared/location-intelligence.js";
import type { PipelineConfig } from "@shared/types";

const ENV_PREFIX = "SCHEDULED_PIPELINE";

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
 * Compute the next UTC Date for a given local hour + IANA timezone.
 * Synchronous and safe: TZ is swapped, used, and restored without awaiting.
 * ponytail: Node's Date respects TZ for setHours/getDate DST transitions.
 */
function computeNextUtcDate(localHour: number, timeZone: string): Date {
  const previousTz = process.env.TZ;
  const needsSwap = previousTz !== timeZone;
  if (needsSwap) process.env.TZ = timeZone;
  try {
    const now = new Date();
    const next = new Date(now);
    next.setHours(localHour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return new Date(next.toISOString());
  } finally {
    if (needsSwap) process.env.TZ = previousTz;
  }
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

  const result = await runPipeline(pipelineConfig);
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

async function checkAndRunOnStartup(): Promise<void> {
  const todayRun = await pipelineRepo.getLatestPipelineRunToday();
  if (!todayRun) {
    logger.info("No pipeline run today — running now");
    await executeScheduledRun();
  } else if (todayRun.status === "failed") {
    logger.info("Today's pipeline run failed — retrying now", {
      runId: todayRun.id,
    });
    await executeScheduledRun();
  } else {
    logger.info("Skipping startup run — pipeline already ran today", {
      status: todayRun.status,
      runId: todayRun.id,
    });
  }
}

function scheduleNextRun(): void {
  clearScheduledRun();

  const hour = Number(process.env[`${ENV_PREFIX}_HOUR`] ?? "7");
  const timeZone = process.env[`${ENV_PREFIX}_TIMEZONE`] ?? "America/Tijuana";
  const nextRun = computeNextUtcDate(hour, timeZone);
  const delay = nextRun.getTime() - Date.now();

  logger.info("Scheduled pipeline run", {
    nextRun: nextRun.toISOString(),
    localTime: `${hour}:00`,
    timeZone,
  });

  state.timer = setTimeout(async () => {
    await executeScheduledRun();
    scheduleNextRun();
  }, delay);
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

  logger.info("Initializing scheduled pipeline runner", {
    savedSearchName,
    tenantId,
    userId,
  });

  // Wrap all operations in the correct tenant/user context.
  await runWithRequestContext({ tenantId, userId }, async () => {
    await checkAndRunOnStartup();
    scheduleNextRun();
  });
}
