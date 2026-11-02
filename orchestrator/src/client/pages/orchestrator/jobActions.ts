import type {
  JobActionResponse,
  JobActionResult,
  JobListItem,
} from "@shared/types";

const SKIPPABLE_STATUSES = new Set(["discovered", "ready"]);

export function canSkip(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => SKIPPABLE_STATUSES.has(job.status))
  );
}

export function canMoveToReady(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status === "discovered");
}

export function canRescore(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status !== "processing");
}

export function getFailedJobIds(response: JobActionResponse): Set<string> {
  const failedIds = response.results
    .filter((result) => !result.ok)
    .map((result) => result.jobId);
  return new Set(failedIds);
}

type FailedJobActionResult = Extract<JobActionResult, { ok: false }>;

/**
 * Per-job failures caused by a rejected Reactive Resume API key. The server
 * reports these with the UNAUTHORIZED code so the UI can point at Settings.
 */
export function getUnauthorizedResults(
  response: JobActionResponse,
): FailedJobActionResult[] {
  return response.results.filter(
    (result): result is FailedJobActionResult =>
      !result.ok && result.error.code === "UNAUTHORIZED",
  );
}
