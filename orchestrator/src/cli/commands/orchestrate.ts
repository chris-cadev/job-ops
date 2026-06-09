/**
 * `jobops orchestrate` — run a scheduled maintenance sequence.
 *
 * Default flow:
 *   1. Health check (app status)       — fail-fast if server is down
 *   2. Pipeline status check            — skip pipeline if already running
 *   3. Pipeline trigger                 — start a new pipeline run
 *   4. Backup creation                  — create a manual backup
 *
 * Steps can be skipped via flags. Pipeline and backup are always conditional
 * on the prior step succeeding. Output is always JSON for machine parsing.
 */

import { apiRequest, CliError, publicApiRequest } from "../lib/client.js";
import { loadConfig } from "../lib/config.js";
import { printError, printJson, printSuccess } from "../lib/output.js";

interface OrchestrateReport {
  ok: boolean;
  timestamp: string;
  apiUrl: string;
  steps: OrchestrateStep[];
}

interface OrchestrateStep {
  name: string;
  status: "skipped" | "passed" | "failed";
  durationMs: number;
  data?: unknown;
  error?: string;
}

function step(
  name: string,
  durationMs: number,
  status: "skipped" | "passed" | "failed",
  data?: unknown,
  error?: string,
): OrchestrateStep {
  return { name, status, durationMs, data, error };
}

export async function cmdOrchestrate(
  options: Record<string, string>,
): Promise<void> {
  const apiUrl = options["api-url"] || loadConfig().apiUrl;
  const report: OrchestrateReport = {
    ok: true,
    timestamp: new Date().toISOString(),
    apiUrl,
    steps: [],
  };

  const skipPipeline = options["skip-pipeline"] === "true";
  const skipBackup = options["skip-backup"] === "true";
  const onlyPipeline = options["pipeline-only"] === "true";
  const onlyBackup = options["backup-only"] === "true";

  try {
    // ─── Step 1: Health Check ───────────────────────────────────────
    if (onlyBackup) {
      report.steps.push(step("health", 0, "skipped"));
    } else {
      const t0 = performance.now();
      try {
        await publicApiRequest("GET", "/app/status", { apiUrl });
        report.steps.push(step("health", performance.now() - t0, "passed"));
        printSuccess("Server is healthy");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Health check failed";
        report.steps.push(
          step("health", performance.now() - t0, "failed", undefined, msg),
        );
        report.ok = false;
        printError(`Health check failed: ${msg}`);
        printJson(report);
        process.exit(1);
      }
    }

    // ─── Step 2: Pipeline Status Check ──────────────────────────────
    if (skipPipeline || onlyBackup) {
      report.steps.push(step("pipeline_status", 0, "skipped"));
    } else {
      const t0 = performance.now();
      try {
        const status = await apiRequest<{ isRunning: boolean }>(
          "GET",
          "/pipeline/status",
          undefined,
          { apiUrl },
        );
        if (status.isRunning) {
          report.steps.push(
            step(
              "pipeline_status",
              performance.now() - t0,
              "failed",
              status,
              "Pipeline is already running — skipping trigger",
            ),
          );
          report.ok = false;
          printError("Pipeline is already running — skipping trigger");
        } else {
          report.steps.push(
            step("pipeline_status", performance.now() - t0, "passed", status),
          );
          printSuccess("Pipeline is idle");
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Pipeline status check failed";
        report.steps.push(
          step(
            "pipeline_status",
            performance.now() - t0,
            "failed",
            undefined,
            msg,
          ),
        );
        report.ok = false;
        printError(`Pipeline status check failed: ${msg}`);
      }
    }

    // ─── Step 3: Pipeline Trigger ──────────────────────────────────
    if (
      skipPipeline ||
      onlyBackup ||
      report.steps.find((s) => s.name === "pipeline_status")?.status !==
        "passed"
    ) {
      if (!skipPipeline && !onlyBackup) {
        report.steps.push(step("pipeline_run", 0, "skipped"));
      }
    } else {
      const t0 = performance.now();
      try {
        const body: Record<string, unknown> = {};
        if (options["top-n"]) body.topN = Number(options["top-n"]);
        if (options["min-score"])
          body.minSuitabilityScore = Number(options["min-score"]);
        if (options.sources)
          body.sources = options.sources
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

        const result = await apiRequest<{ message: string }>(
          "POST",
          "/pipeline/run",
          body,
          { apiUrl },
        );
        report.steps.push(
          step("pipeline_run", performance.now() - t0, "passed", result),
        );
        printSuccess(`Pipeline triggered: ${result.message}`);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Pipeline trigger failed";
        report.steps.push(
          step(
            "pipeline_run",
            performance.now() - t0,
            "failed",
            undefined,
            msg,
          ),
        );
        report.ok = false;
        printError(`Pipeline trigger failed: ${msg}`);
      }
    }

    // ─── Step 4: Backup Creation ───────────────────────────────────
    if (skipBackup || onlyPipeline) {
      report.steps.push(step("backup", 0, "skipped"));
    } else {
      const t0 = performance.now();
      try {
        const result = await apiRequest("POST", "/backups", undefined, {
          apiUrl,
        });
        report.steps.push(
          step("backup", performance.now() - t0, "passed", result),
        );
        printSuccess("Backup created");
      } catch (err) {
        if (err instanceof CliError && err.code === "FORBIDDEN") {
          report.steps.push(
            step(
              "backup",
              performance.now() - t0,
              "skipped",
              undefined,
              "Not a system admin — skipping backup",
            ),
          );
        } else {
          const msg =
            err instanceof Error ? err.message : "Backup creation failed";
          report.steps.push(
            step("backup", performance.now() - t0, "failed", undefined, msg),
          );
          printError(`Backup creation failed: ${msg}`);
        }
      }
    }
  } finally {
    printJson(report);
  }
}
