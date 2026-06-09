/**
 * `jobops jobs` commands — list, actions.
 */

import type { JobActionResponse, JobsListResponse } from "@shared/types";
import { apiRequest } from "../lib/client.js";
import { printJson, printTable } from "../lib/output.js";

export async function cmdJobsList(
  options: Record<string, string>,
): Promise<void> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.view) params.set("view", options.view);

  const query = params.toString();
  const path = `/jobs${query ? `?${query}` : ""}`;

  const data = await apiRequest<JobsListResponse>("GET", path, undefined, {
    apiUrl: options["api-url"],
  });

  if (options.format === "table") {
    const rows = data.jobs.map((job) => ({
      id: `${job.id.slice(0, 8)}…`,
      title: (job.title || "").slice(0, 50),
      employer: (job.employer || "").slice(0, 30),
      status: job.status,
      score: job.suitabilityScore ?? "-",
      location: (job.location || "").slice(0, 25),
    }));
    printTable(rows);
  } else {
    printJson(data);
  }
}

export async function cmdJobsActions(
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  const action = args[0];
  if (!action || !["skip", "move_to_ready", "rescore"].includes(action)) {
    console.error(
      "Usage: jobops jobs actions <skip|move_to_ready|rescore> --job-ids <id1,id2,...>",
    );
    console.error("  Options:");
    console.error(
      "    --job-ids     Comma-separated list of job IDs (required)",
    );
    console.error("    --force       Force move_to_ready even without PDF");
    process.exit(1);
  }

  const jobIdsRaw = options["job-ids"] || "";
  const jobIds = jobIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (jobIds.length === 0) {
    console.error("No job IDs provided. Use --job-ids <id1,id2,...>");
    process.exit(1);
  }

  const body: Record<string, unknown> = { action, jobIds };
  if (action === "move_to_ready" && options.force === "true") {
    body.options = { force: true };
  }

  const data = await apiRequest<JobActionResponse>(
    "POST",
    "/jobs/actions",
    body,
    { apiUrl: options["api-url"] },
  );

  printJson(data);
}

export async function dispatchJobs(
  subcommand: string,
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "list":
      return cmdJobsList(options);
    case "actions":
      return cmdJobsActions(args, options);
    default:
      console.error(`Unknown jobs subcommand: "${subcommand}"`);
      console.error("Available: list, actions");
      process.exit(1);
  }
}
