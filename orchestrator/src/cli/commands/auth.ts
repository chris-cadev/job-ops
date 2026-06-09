/**
 * `jobops auth` commands — login, logout, status.
 */

import { apiRequest, login as doLogin } from "../lib/client.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { printJson, printSuccess } from "../lib/output.js";

export async function cmdLogin(
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  const username = args[0] || options.username || "";
  const password = options.password || "";

  if (!username || !password) {
    console.error(
      "Usage: jobops auth login <username> [--password <password>]",
    );
    console.error(
      "  or:   jobops auth login --username <user> --password <pass>",
    );
    process.exit(1);
  }

  await doLogin(username, password, { apiUrl: options["api-url"] });
  printSuccess(`Logged in as "${username}"`);
}

export async function cmdLogout(): Promise<void> {
  const config = loadConfig();
  saveConfig({ ...config, token: null });
  printSuccess("Logged out (token cleared)");
}

export async function cmdAuthStatus(
  options: Record<string, string>,
): Promise<void> {
  const config = loadConfig();

  if (!config.token) {
    printJson({
      authenticated: false,
      apiUrl: config.apiUrl,
      reason: "No token stored. Run 'jobops auth login' first.",
    });
    return;
  }

  // Verify the token is still valid by calling /api/auth/me
  try {
    const me = await apiRequest<{ id: string; username: string }>(
      "GET",
      "/auth/me",
      undefined,
      { apiUrl: options["api-url"] },
    );
    printJson({ authenticated: true, apiUrl: config.apiUrl, user: me });
  } catch {
    printJson({
      authenticated: false,
      apiUrl: config.apiUrl,
      reason: "Token expired or invalid. Run 'jobops auth login' again.",
    });
  }
}

export async function dispatchAuth(
  subcommand: string,
  args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "login":
      return cmdLogin(args, options);
    case "logout":
      return cmdLogout();
    case "status":
      return cmdAuthStatus(options);
    default:
      console.error(`Unknown auth subcommand: "${subcommand}"`);
      console.error("Available: login, logout, status");
      process.exit(1);
  }
}
