/**
 * Standalone script to run the target filter without the full pipeline.
 * Marks off-target `discovered` jobs as `skipped` in the central jobs.db
 * and persists last-run metadata in `settings.targetFilterState`.
 *
 * Usage: npm run filter:target
 * Optional: TARGET_FILTER_TENANT_ID (defaults to tenant_default)
 */

import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "@infra/request-context";
import "../config/env";
import { closeDb } from "../db/index";
import { filterNonTargetStep } from "./steps/filter-non-target";

async function main() {
  console.log("=".repeat(60));
  console.log("🎯 Target Filter Runner");
  console.log(`   Started at: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const tenantId = (process.env.TARGET_FILTER_TENANT_ID ?? "").trim();

  const result = await runWithRequestContext(
    {
      requestId: randomUUID(),
      ...(tenantId ? { tenantId } : {}),
    },
    () => filterNonTargetStep(),
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Target Filter Results:");
  console.log(`   Checked: ${result.checked}`);
  console.log(`   Skipped: ${result.skipped}`);
  console.log(`   Last run: ${result.lastRunAt}`);
  console.log(`   Completed at: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  closeDb();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  closeDb();
  process.exit(1);
});
