/**
 * `jobops settings` commands — get.
 */

import { apiRequest } from "../lib/client.js";
import { printJson } from "../lib/output.js";

export async function cmdSettingsGet(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<Record<string, unknown>>(
    "GET",
    "/settings",
    undefined,
    { apiUrl: options["api-url"] },
  );
  printJson(data);
}

export async function dispatchSettings(
  subcommand: string,
  _args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "get":
      return cmdSettingsGet(options);
    default:
      console.error(`Unknown settings subcommand: "${subcommand}"`);
      console.error("Available: get");
      process.exit(1);
  }
}
