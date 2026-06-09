/**
 * CLI configuration file management.
 *
 * Stores persistent config (API URL, auth token) in a JSON file at:
 *   - Unix: ~/.config/jobops/config.json
 *   - Windows: %APPDATA%/jobops/config.json
 *
 * Falls back to ~/.jobops/config.json if the platform dir is unavailable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  token: string | null;
}

const DEFAULT_API_URL = "http://localhost:3001";

function getConfigDir(): string {
  const home = homedir();
  if (platform() === "win32") {
    // Use %APPDATA% on Windows
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "jobops");
    // Fallback: ~/.jobops
    return join(home, ".jobops");
  }
  // XDG convention on Linux/macOS
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "jobops");
  return join(home, ".config", "jobops");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(): CliConfig {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<CliConfig>;
      return {
        apiUrl: parsed.apiUrl || DEFAULT_API_URL,
        token: parsed.token || null,
      };
    }
  } catch {
    // If file is corrupt, start fresh
  }
  return { apiUrl: DEFAULT_API_URL, token: null };
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export function resolveApiUrl(override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  const fromEnv = process.env.JOBOPS_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const config = loadConfig();
  return config.apiUrl;
}
