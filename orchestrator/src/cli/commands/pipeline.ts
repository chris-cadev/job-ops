/**
 * `jobops pipeline` commands — status, run, runs, runs:insights.
 */

import type {
  PipelineRun,
  PipelineRunInsights,
  PipelineStatusResponse,
} from "@shared/types";
import { apiRequest } from "../lib/client.js";
import { printJson, printTable } from "../lib/output.js";

export async function cmdPipelineStatus(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<PipelineStatusResponse>(
    "GET",
    "/pipeline/status",
    undefined,
    { apiUrl: options["api-url"] },
  );
  if (options.format === "table") {
    printTable([
      {
        running: data.isRunning,
        lastRunId: data.lastRun?.id ?? "-",
        lastRunStatus: data.lastRun?.status ?? "-",
        lastRunStarted: data.lastRun?.startedAt ?? "-",
      },
    ]);
  } else {
    printJson(data);
  }
}

export async function cmdPipelineRun(
  options: Record<string, string>,
): Promise<void> {
  const body: Record<string, unknown> = {};

  if (options["top-n"]) body.topN = Number(options["top-n"]);
  if (options["min-score"])
    body.minSuitabilityScore = Number(options["min-score"]);
  if (options.sources)
    body.sources = options.sources
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (options.budget) body.runBudget = Number(options.budget);
  if (options["search-terms"])
    body.searchTerms = options["search-terms"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (options.country) body.country = options.country;

  const data = await apiRequest<{ message: string }>(
    "POST",
    "/pipeline/run",
    body,
    { apiUrl: options["api-url"] },
  );
  printJson(data);
}

export async function cmdPipelineRuns(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<PipelineRun[]>(
    "GET",
    "/pipeline/runs",
    undefined,
    { apiUrl: options["api-url"] },
  );

  if (options.format === "table") {
    const rows = data.map((run) => ({
      id: `${run.id.slice(0, 12)}…`,
      status: run.status,
      started: run.startedAt,
      discovered: run.jobsDiscovered,
      processed: run.jobsProcessed,
      error: run.errorMessage ?? "-",
    }));
    printTable(rows);
  } else {
    printJson(data);
  }
}

export async function cmdPipelineRunInsights(
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  const runId = args[0];
  if (!runId) {
    console.error("Usage: jobops pipeline runs:insights <run-id>");
    process.exit(1);
  }

  const data = await apiRequest<PipelineRunInsights>(
    "GET",
    `/pipeline/runs/${encodeURIComponent(runId)}/insights`,
    undefined,
    { apiUrl: options["api-url"] },
  );
  printJson(data);
}

export async function dispatchPipeline(
  subcommand: string,
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "status":
      return cmdPipelineStatus(options);
    case "run":
      return cmdPipelineRun(options);
    case "runs":
      return cmdPipelineRuns(options);
    case "runs:insights":
      return cmdPipelineRunInsights(args, options);
    default:
      console.error(`Unknown pipeline subcommand: "${subcommand}"`);
      console.error("Available: status, run, runs, runs:insights");
      process.exit(1);
  }
}
