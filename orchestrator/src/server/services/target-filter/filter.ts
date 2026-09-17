import { logger } from "@infra/logger";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import {
  createConfiguredLlmService,
  resolveLlmModel,
} from "@server/services/modelSelection";
import type { Job } from "@shared/types";

const FILTER_SCHEMA: JsonSchemaDefinition = {
  name: "job_target_filter",
  schema: {
    type: "object",
    properties: {
      isTarget: {
        type: "boolean",
        description: "True if the job matches the target profile",
      },
      reason: {
        type: "string",
        description: "Brief 1-sentence explanation",
      },
    },
    required: ["isTarget", "reason"],
    additionalProperties: false,
  },
};

const FILTER_BATCH_SCHEMA: JsonSchemaDefinition = {
  name: "job_target_filter_batch",
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            jobIndex: {
              type: "integer",
              description: "Zero-based index of the job in the prompt",
            },
            isTarget: {
              type: "boolean",
              description: "True if the job matches the target profile",
            },
            reason: {
              type: "string",
              description: "Brief 1-sentence explanation",
            },
          },
          required: ["jobIndex", "isTarget", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

const MAX_DESCRIPTION_CHARS = 2000;

// Approx char budget per batch LLM call (jobs portion; profile is fixed overhead).
export const BATCH_BUDGET_CHARS = 12_000;

export type BatchJob = Pick<
  Job,
  "id" | "title" | "employer" | "jobDescription"
>;

export type JobVerdict = { isTarget: boolean; reason: string };

// ponytail: entry-level titles always pass, even in excluded categories
export const ENTRY_LEVEL_PATTERN =
  /\b(junior|entry[-\s]?level|graduate|intern(?:ship)?|trainee|\bjr\.?\b)/i;

export function isEntryLevelTitle(title: string): boolean {
  return ENTRY_LEVEL_PATTERN.test(title ?? "");
}

function truncate(value: string | null, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : value.slice(0, max);
}

export function buildTargetFilterPrompt(
  job: Pick<Job, "title" | "employer" | "jobDescription">,
  profileMd: string,
): string {
  return [
    "Decide if this job posting matches the target profile below.",
    "Reply with JSON matching the schema (isTarget, reason).",
    "",
    "--- TARGET PROFILE ---",
    profileMd.trim(),
    "--- JOB ---",
    `Title: ${job.title}`,
    `Employer: ${job.employer}`,
    `Description: ${truncate(job.jobDescription, MAX_DESCRIPTION_CHARS)}`,
  ].join("\n");
}

export function buildTargetBatchPrompt(
  jobs: BatchJob[],
  profileMd: string,
): string {
  const blocks = jobs.map((job, index) =>
    [
      `--- JOB #${index} ---`,
      `Title: ${job.title}`,
      `Employer: ${job.employer}`,
      `Description: ${truncate(job.jobDescription, MAX_DESCRIPTION_CHARS)}`,
    ].join("\n"),
  );
  return [
    "Decide for EACH job posting below whether it matches the target profile.",
    'Reply with JSON matching the schema: {"results": [{"jobIndex": 0, "isTarget": true/false, "reason": "..."}]}.',
    `Return exactly one entry per job, for jobIndex 0 to ${jobs.length - 1}.`,
    "",
    "--- TARGET PROFILE ---",
    profileMd.trim(),
    "",
    ...blocks,
  ].join("\n");
}

function batchJobSize(job: BatchJob): number {
  return (
    (job.title?.length ?? 0) +
    (job.employer?.length ?? 0) +
    Math.min(job.jobDescription?.length ?? 0, MAX_DESCRIPTION_CHARS)
  );
}

/**
 * Split jobs into chunks that fit the char budget. A single oversized job
 * goes alone in its chunk rather than being dropped.
 */
export function chunkJobsByBudget(
  jobs: BatchJob[],
  maxChars: number = BATCH_BUDGET_CHARS,
): BatchJob[][] {
  const chunks: BatchJob[][] = [];
  let current: BatchJob[] = [];
  let currentChars = 0;
  for (const job of jobs) {
    const size = batchJobSize(job);
    if (current.length > 0 && currentChars + size > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(job);
    currentChars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Classify a batch of jobs in a single LLM call. Verdicts come back aligned
 * with the input order. Any malformed output fails the whole batch so the
 * caller can retry those jobs one by one.
 */
export async function classifyJobBatch(args: {
  jobs: BatchJob[];
  profileMd: string;
}): Promise<
  { success: true; verdicts: JobVerdict[] } | { success: false; error: string }
> {
  const { jobs, profileMd } = args;
  if (jobs.length === 0) return { success: true, verdicts: [] };

  const model = await resolveLlmModel("scoring");
  const llm = await createConfiguredLlmService("scoring");
  const result = await llm.callJson<{
    results: Array<{ jobIndex: number; isTarget: boolean; reason: string }>;
  }>({
    model,
    messages: [
      { role: "user", content: buildTargetBatchPrompt(jobs, profileMd) },
    ],
    jsonSchema: FILTER_BATCH_SCHEMA,
    maxRetries: 2,
  });

  if (!result.success) {
    logger.warn("Target filter batch LLM call failed", {
      count: jobs.length,
      error: result.error,
    });
    return { success: false, error: result.error };
  }

  const { results } = result.data;
  if (!Array.isArray(results)) {
    return { success: false, error: "Batch response has no results array" };
  }
  const byIndex = new Map<number, JobVerdict>();
  for (const entry of results) {
    if (
      typeof entry?.jobIndex !== "number" ||
      typeof entry?.isTarget !== "boolean"
    ) {
      return { success: false, error: "Batch entry failed validation" };
    }
    byIndex.set(entry.jobIndex, {
      isTarget: entry.isTarget,
      reason: entry.reason || "No reason provided",
    });
  }
  const verdicts: JobVerdict[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const verdict = byIndex.get(index);
    if (!verdict) {
      return { success: false, error: `Batch missing verdict for #${index}` };
    }
    verdicts.push(verdict);
  }
  return { success: true, verdicts };
}

export async function classifyJobTarget(args: {
  job: Pick<Job, "id" | "title" | "employer" | "jobDescription">;
  profileMd: string;
}): Promise<{ isTarget: boolean; reason: string }> {
  const { job, profileMd } = args;
  if (isEntryLevelTitle(job.title)) {
    return { isTarget: true, reason: "Entry-level title, kept per profile" };
  }

  const model = await resolveLlmModel("scoring");
  const llm = await createConfiguredLlmService("scoring");
  const result = await llm.callJson<{ isTarget: boolean; reason: string }>({
    model,
    messages: [
      { role: "user", content: buildTargetFilterPrompt(job, profileMd) },
    ],
    jsonSchema: FILTER_SCHEMA,
    maxRetries: 2,
    jobId: job.id,
  });

  if (!result.success) {
    logger.warn("Target filter LLM call failed, keeping job", {
      jobId: job.id,
      error: result.error,
    });
    return { isTarget: true, reason: "Filter undecided (LLM error), kept" };
  }
  if (typeof result.data.isTarget !== "boolean") {
    return { isTarget: true, reason: "Filter undecided (bad output), kept" };
  }
  return {
    isTarget: result.data.isTarget,
    reason: result.data.reason || "No reason provided",
  };
}
