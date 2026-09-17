import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import {
  type BatchJob,
  chunkJobsByBudget,
  classifyJobBatch,
  classifyJobTarget,
  isEntryLevelTitle,
  type JobVerdict,
} from "@server/services/target-filter/filter";
import { loadTargetProfile } from "@server/services/target-filter/profile";

export type TargetFilterResult = {
  checked: number;
  skipped: number;
  lastRunAt: string;
};

/**
 * Filtra ofertas `discovered` contra el markdown de target profile.
 * El subconjunto lo define solo el status (`discovered`), sin importar si
 * ya tienen suitabilityScore. Los jobs se clasifican por lotes en una sola
 * llamada LLM; si un lote falla se reintenta job por job. Idempotente por
 * estado (`skipped` no re-entra). Fecha/conteo persistidos en la base
 * central (`settings.targetFilterState`, scoped por tenant).
 */
export async function filterNonTargetStep(
  args: { pipelineRunId?: string; shouldCancel?: () => boolean } = {},
): Promise<TargetFilterResult> {
  const lastRunAt = new Date().toISOString();
  const { text: profileMd, source } = await loadTargetProfile();
  logger.info("Running target filter step", { source });

  const jobs = await jobsRepo.getDiscoveredJobs();
  // Entry-level titles and applied jobs never reach the LLM.
  const candidates = jobs.filter(
    (job) => job.status !== "applied" && !isEntryLevelTitle(job.title),
  );
  let skipped = 0;

  // Sequential chunks: local LLM models share a single KV cache.
  for (const chunk of chunkJobsByBudget(candidates)) {
    if (args.shouldCancel?.()) break;
    const verdicts = await classifyChunk(chunk, profileMd, args.shouldCancel);
    if (args.shouldCancel?.()) break;
    for (const [index, verdict] of verdicts.entries()) {
      if (!verdict || verdict.isTarget) continue;
      const job = chunk[index];
      await jobsRepo.updateJob(job.id, {
        status: "skipped",
        suitabilityReason: `off-target: ${verdict.reason}`.slice(0, 2000),
      });
      skipped += 1;
      logger.info("Target filter skipped job", {
        jobId: job.id,
        title: job.title,
      });
    }
  }

  const state = JSON.stringify({
    lastRunAt,
    ...(args.pipelineRunId ? { lastPipelineRunId: args.pipelineRunId } : {}),
    checked: jobs.length,
    skipped,
  });
  // Best-effort: run metadata must not fail the pipeline run.
  try {
    await settingsRepo.setSetting("targetFilterState", state);
  } catch (error) {
    logger.warn("Failed to persist target filter state", { error });
  }

  logger.info("Target filter step completed", {
    checked: jobs.length,
    skipped,
  });
  return { checked: jobs.length, skipped, lastRunAt };
}

async function classifyChunk(
  chunk: BatchJob[],
  profileMd: string,
  shouldCancel?: () => boolean,
): Promise<Array<JobVerdict | null>> {
  const batch = await classifyJobBatch({ jobs: chunk, profileMd });
  if (batch.success) return batch.verdicts;

  logger.warn("Target filter batch failed, retrying one by one", {
    count: chunk.length,
    error: batch.error,
  });
  const verdicts: Array<JobVerdict | null> = [];
  for (const job of chunk) {
    if (shouldCancel?.()) {
      verdicts.push(null);
      continue;
    }
    verdicts.push(await classifyJobTarget({ job, profileMd }));
  }
  return verdicts;
}
