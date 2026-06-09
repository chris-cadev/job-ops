/**
 * HTTP client for the Job Ops REST API.
 *
 * Wraps fetch with auth header injection, JSON response parsing,
 * and standard error handling per the API response contract.
 */

import { loadConfig, saveConfig } from "./config.js";

export class CliError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface ApiOkResponse<T> {
  ok: true;
  data: T;
  meta?: { requestId: string };
}

export interface ApiErrorResponse {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string };
}

export type ApiResponse<T> = ApiOkResponse<T> | ApiErrorResponse;

/**
 * Perform an authenticated API request.
 * Automatically injects the Bearer token from config.
 */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { apiUrl?: string; rawResponse?: boolean },
): Promise<T> {
  const config = loadConfig();
  const baseUrl = options?.apiUrl || config.apiUrl;
  const url = `${baseUrl}/api${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: ApiResponse<T>;
  try {
    parsed = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new CliError(
      `Server returned non-JSON (HTTP ${res.status}). Is the server running at ${baseUrl}?`,
      res.status,
    );
  }

  if (!parsed.ok) {
    throw new CliError(
      parsed.error.message || "Request failed",
      res.status,
      parsed.error.code,
      parsed.meta?.requestId,
    );
  }

  return parsed.data;
}

/**
 * Login and persist the JWT token.
 */
export async function login(
  username: string,
  password: string,
  options?: { apiUrl?: string },
): Promise<void> {
  const baseUrl = options?.apiUrl || loadConfig().apiUrl;
  const url = `${baseUrl}/api/auth/login`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const text = await res.text();
  let parsed: ApiResponse<{ token: string }>;
  try {
    parsed = JSON.parse(text) as ApiResponse<{ token: string }>;
  } catch {
    throw new CliError(
      `Server returned non-JSON (HTTP ${res.status}). Is the server running at ${baseUrl}?`,
      res.status,
    );
  }

  if (!parsed.ok) {
    throw new CliError(
      parsed.error.message || "Login failed",
      res.status,
      parsed.error.code,
    );
  }

  if (!parsed.data?.token) {
    throw new CliError("Login succeeded but no token was returned");
  }

  saveConfig({ apiUrl: baseUrl, token: parsed.data.token });
}

/**
 * Perform a request without auth (for public endpoints).
 */
export async function publicApiRequest<T>(
  method: string,
  path: string,
  options?: { apiUrl?: string; body?: unknown },
): Promise<T> {
  const baseUrl = options?.apiUrl || loadConfig().apiUrl;
  const url = `${baseUrl}/api${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let parsed: ApiResponse<T>;
  try {
    parsed = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new CliError(
      `Server returned non-JSON (HTTP ${res.status}). Is the server running at ${baseUrl}?`,
      res.status,
    );
  }

  if (!parsed.ok) {
    throw new CliError(
      parsed.error.message || "Request failed",
      res.status,
      parsed.error.code,
      parsed.meta?.requestId,
    );
  }

  return parsed.data;
}
