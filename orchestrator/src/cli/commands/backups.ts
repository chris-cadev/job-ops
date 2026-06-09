/**
 * `jobops backups` commands — list, create.
 */

import type { BackupInfo } from "@shared/types";
import { apiRequest } from "../lib/client.js";
import { printJson, printTable } from "../lib/output.js";

export async function cmdBackupsList(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<{
    backups: BackupInfo[];
    nextScheduled: string | null;
  }>("GET", "/backups", undefined, { apiUrl: options["api-url"] });

  if (options.format === "table") {
    const rows = data.backups.map((b) => ({
      filename: b.filename,
      type: b.type,
      size: `${(b.size / 1024).toFixed(1)} KB`,
      created: b.createdAt,
    }));
    printTable(rows);
    if (data.nextScheduled) {
      console.log(`\nNext scheduled backup: ${data.nextScheduled}`);
    }
  } else {
    printJson(data);
  }
}

export async function cmdBackupsCreate(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<BackupInfo>("POST", "/backups", undefined, {
    apiUrl: options["api-url"],
  });
  printJson(data);
}

export async function dispatchBackups(
  subcommand: string,
  _args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "list":
      return cmdBackupsList(options);
    case "create":
      return cmdBackupsCreate(options);
    default:
      console.error(`Unknown backups subcommand: "${subcommand}"`);
      console.error("Available: list, create");
      process.exit(1);
  }
}
