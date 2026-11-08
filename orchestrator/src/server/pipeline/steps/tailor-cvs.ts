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
 * Fan-out/fan-in for external cv-tailoring per job (bounded concurrency),
 * then join with counts. Never throws; per-job failures are collected,
 * not raised.
 *
 * Input contract:
 * - `jobIds` undefined (legacy): fans out over every discovered job with a
 *   description (pipeline behavior before survivor scoping).
 * - `jobIds` defined: fans out over exactly those survivor IDs, resolved via
 *   `getJobById` (missing rows dropped) and filtered to non-empty JD.
 *   `[]` short-circuits to zeros without a DB scan or pool — it means the
 *   run selected no survivors, not "fall back to all-discovered".
 */
export async function tailorCvsStep(args: {
  config: CvTailoringConfig;
  force?: boolean;
  shouldCancel?: () => boolean;
  jobIds?: string[];
}): Promise<TailorCvsStepResult> {
  const result: TailorCvsStepResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  let jobs: Array<{ id: string; jobDescription?: string | null }>;
  if (args.jobIds !== undefined) {
    if (args.jobIds.length === 0) return result;
    const uniqueIds = [...new Set(args.jobIds)];
    const resolved = await Promise.all(
      uniqueIds.map((id) => jobsRepo.getJobById(id)),
    );
    jobs = resolved.filter(
      (job): job is NonNullable<typeof job> => job !== null,
    );
  } else {
    jobs = await jobsRepo.getDiscoveredJobs();
  }
  const eligible = jobs.filter((job) => job.jobDescription?.trim());
  if (eligible.length === 0) return result;
  result.attempted = eligible.length;

  const outcomes = await asyncPool({
    items: eligible,
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
