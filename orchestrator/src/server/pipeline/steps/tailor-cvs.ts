import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import * as jobsRepo from "@server/repositories/jobs";
import {
  type CvTailoringConfig,
  type CvTailoringJobResult,
  runCvTailoringForJob,
} from "@server/services/cv-tailoring-bridge";
import { asyncPool } from "@server/utils/async-pool";

export type TailorCvsStepResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/**
 * Fan-out/fan-in over every discovered job with a description: run external
 * cv-tailoring per job (bounded concurrency), then join with counts.
 * Never throws; per-job failures are collected, not raised.
 */
export async function tailorCvsStep(args: {
  config: CvTailoringConfig;
  force?: boolean;
  shouldCancel?: () => boolean;
}): Promise<TailorCvsStepResult> {
  const result: TailorCvsStepResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  const jobs = (await jobsRepo.getDiscoveredJobs()).filter((job) =>
    job.jobDescription?.trim(),
  );
  if (jobs.length === 0) return result;
  result.attempted = jobs.length;

  const outcomes = await asyncPool({
    items: jobs,
    concurrency: args.config.concurrency,
    shouldStop: args.shouldCancel,
    task: async (job): Promise<CvTailoringJobResult> => {
      try {
        return await runWithRequestContext({ jobId: job.id }, () =>
          runCvTailoringForJob(job.id, args.config, { force: args.force }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.warn("CV tailoring failed for job", { jobId: job.id, message });
        return { jobId: job.id, success: false, error: message };
      }
    },
  });

  for (const outcome of outcomes) {
    if (outcome.success) result.succeeded += 1;
    else if (outcome.skipped) result.skipped += 1;
    else result.failed += 1;
  }

  logger.info("CV tailoring phase completed", { ...result });
  return result;
}
