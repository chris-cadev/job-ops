import { logger } from "@infra/logger";
import { getPipelineEventBus } from "@server/infra/event-bus";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { generateJobBrief } from "@server/services/job-brief";
import { scoreJobSuitability } from "@server/services/scorer";
import * as visaSponsors from "@server/services/visa-sponsors/index";
import { asyncPool } from "@server/utils/async-pool";
import type { Job } from "@shared/types";
import { progressHelpers, updateProgress } from "../progress";
import type { ScoredJob } from "./types";

const SCORING_CONCURRENCY = 2;
const MAX_SCORING_RETRIES = 3;
const RETRY_BACKOFF_MS = 5_000;

// ---------------------------------------------------------------------------
// Per-job scoring result
// ---------------------------------------------------------------------------
type ScoreJobOutcome =
  | { success: true; score: number; reason: string }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// Internal helper: score a single job and persist results
// ---------------------------------------------------------------------------
async function scoreSingleJob(args: {
  job: Job;
  profile: Record<string, unknown>;
  autoSkipThreshold: number | null;
}): Promise<ScoreJobOutcome> {
  const { job, profile, autoSkipThreshold } = args;

  // Sequential: local LLM models share a single KV cache — running
  // scoring and brief extraction in parallel causes "Context size exceeded".
  const { score, reason } = await scoreJobSuitability(job, profile);
  const jobBrief = await generateJobBrief(job.jobDescription, {
    jobId: job.id,
  });

  if (score === null) {
    return { success: false, error: reason };
  }

  // Sponsor matching
  let sponsorMatchScore = 0;
  let sponsorMatchNames: string | undefined;

  if (job.employer) {
    const sponsorResults = await visaSponsors.searchSponsors(job.employer, {
      limit: 10,
      minScore: 50,
    });
    const summary = visaSponsors.calculateSponsorMatchSummary(sponsorResults);
    sponsorMatchScore = summary.sponsorMatchScore;
    sponsorMatchNames = summary.sponsorMatchNames ?? undefined;
  }

  // Auto-skip based on score threshold
  const shouldAutoSkip =
    job.status !== "applied" &&
    autoSkipThreshold !== null &&
    !Number.isNaN(autoSkipThreshold) &&
    score < autoSkipThreshold;

  await jobsRepo.updateJob(job.id, {
    suitabilityScore: score,
    suitabilityReason: reason,
    jobBrief,
    sponsorMatchScore,
    sponsorMatchNames,
    ...(shouldAutoSkip ? { status: "skipped" } : {}),
  });

  if (shouldAutoSkip) {
    logger.info("Auto-skipped job due to low score", {
      jobId: job.id,
      title: job.title,
      score,
      threshold: autoSkipThreshold,
    });
  }

  return { success: true, score, reason };
}

// ---------------------------------------------------------------------------
// Main scoring step — scores all unscored jobs concurrently.
// Failures emit events and are collected for later retry.
// ---------------------------------------------------------------------------
export async function scoreJobsStep(args: {
  profile: Record<string, unknown>;
  shouldCancel?: () => boolean;
  onProgress?: (completed: number, total: number) => void | Promise<void>;
}): Promise<{
  unprocessedJobs: Job[];
  scoredJobs: ScoredJob[];
  failedJobIds: string[];
}> {
  logger.info("Running scoring step");
  const unprocessedJobs = await jobsRepo.getUnscoredDiscoveredJobs();

  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;

  updateProgress({
    step: "scoring",
    jobsDiscovered: unprocessedJobs.length,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    currentJob: undefined,
  });

  const scoredJobs: ScoredJob[] = [];
  const failedJobIds: string[] = [];
  let completed = 0;

  await asyncPool({
    items: unprocessedJobs,
    concurrency: SCORING_CONCURRENCY,
    shouldStop: args.shouldCancel,
    collectErrors: true,
    task: async (job) => {
      if (args.shouldCancel?.()) return;

      // Re-check cache — a previous pipeline run may have scored this job
      if (
        typeof job.suitabilityScore === "number" &&
        !Number.isNaN(job.suitabilityScore)
      ) {
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          `${job.title} (cached)`,
        );
        scoredJobs.push({
          ...job,
          suitabilityScore: job.suitabilityScore as number,
          suitabilityReason: job.suitabilityReason ?? "",
        });
        await args.onProgress?.(completed, unprocessedJobs.length);
        return;
      }

      const outcome = await scoreSingleJob({
        job,
        profile: args.profile,
        autoSkipThreshold,
      });

      if (args.shouldCancel?.()) return;

      if (!outcome.success) {
        logger.warn("Scoring failed for job", {
          jobId: job.id,
          title: job.title,
          error: outcome.error,
        });
        failedJobIds.push(job.id);
        getPipelineEventBus().emit("job:scoring-failed", {
          jobId: job.id,
          error: outcome.error,
          attempt: 1,
          maxRetries: MAX_SCORING_RETRIES,
        });
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          `${job.title} (failed)`,
        );
        await args.onProgress?.(completed, unprocessedJobs.length);
        return;
      }

      completed += 1;
      progressHelpers.scoringJob(completed, unprocessedJobs.length, job.title);
      scoredJobs.push({
        ...job,
        suitabilityScore: outcome.score,
        suitabilityReason: outcome.reason,
      });
      await args.onProgress?.(completed, unprocessedJobs.length);
    },
  });

  progressHelpers.scoringComplete(scoredJobs.length);
  logger.info("Scoring step completed", {
    scoredJobs: scoredJobs.length,
    failedJobs: failedJobIds.length,
    concurrency: SCORING_CONCURRENCY,
  });

  return { unprocessedJobs, scoredJobs, failedJobIds };
}

// ---------------------------------------------------------------------------
// Retry failed scoring jobs with exponential backoff.
// Each retry attempt emits a "job:scoring-failed" event so subscribers
// can observe progress. After exhausting retries, remaining failures
// are logged and returned.
// ---------------------------------------------------------------------------
export async function retryFailedScoringJobs(args: {
  failedJobIds: string[];
  profile: Record<string, unknown>;
  shouldCancel: () => boolean;
}): Promise<{
  recoveredJobIds: string[];
  permanentlyFailedJobIds: string[];
}> {
  const { failedJobIds, profile, shouldCancel } = args;
  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;
  const recoveredJobIds: string[] = [];
  let jobs = [...failedJobIds];

  if (jobs.length === 0) {
    return { recoveredJobIds: [], permanentlyFailedJobIds: [] };
  }

  logger.info("Retrying failed scoring jobs", {
    count: jobs.length,
    maxRetries: MAX_SCORING_RETRIES,
  });

  for (
    let attempt = 2;
    attempt <= MAX_SCORING_RETRIES && jobs.length > 0;
    attempt++
  ) {
    if (shouldCancel()) break;

    const delayMs = RETRY_BACKOFF_MS * 2 ** (attempt - 2); // 5s, 10s, 20s
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const remaining: string[] = [];

    for (const jobId of jobs) {
      if (shouldCancel()) break;

      const job = await jobsRepo.getJobById(jobId);
      if (!job) {
        logger.warn("Job disappeared during retry", { jobId });
        continue;
      }

      const outcome = await scoreSingleJob({
        job,
        profile,
        autoSkipThreshold,
      });

      if (outcome.success) {
        recoveredJobIds.push(jobId);
        logger.info("Scoring recovered on retry", {
          jobId,
          attempt,
          score: outcome.score,
        });
      } else {
        remaining.push(jobId);
        getPipelineEventBus().emit("job:scoring-failed", {
          jobId,
          error: outcome.error,
          attempt,
          maxRetries: MAX_SCORING_RETRIES,
        });
      }
    }

    jobs = remaining;
  }

  if (jobs.length > 0) {
    logger.warn("Scoring permanently failed for some jobs", {
      jobIds: jobs,
      maxRetries: MAX_SCORING_RETRIES,
    });
  }

  return {
    recoveredJobIds,
    permanentlyFailedJobIds: jobs,
  };
}
