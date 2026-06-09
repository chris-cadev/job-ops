/**
 * `jobops app` commands — status (health check, no auth required).
 */

import { publicApiRequest } from "../lib/client.js";
import { printJson } from "../lib/output.js";

export async function cmdAppStatus(
  options: Record<string, string>,
): Promise<void> {
  const data = await publicApiRequest<Record<string, unknown>>(
    "GET",
    "/app/status",
    { apiUrl: options["api-url"] },
  );
  printJson(data);
}
