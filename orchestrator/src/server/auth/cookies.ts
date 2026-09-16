import type { Request, Response } from "express";

export const AUTH_COOKIE_NAME = "jobops.session";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name !== AUTH_COOKIE_NAME) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function getCookieAuthToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[AUTH_COOKIE_NAME];
  return token && token.length > 0 ? token : null;
}

/** Bearer first for backward compat, cookie fallback for cross-tab sessions. */
export function getRequestAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return getCookieAuthToken(req);
}

function isSecureCookieContext(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setAuthCookie(
  res: Response,
  token: string,
  expiresIn: number,
): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureCookieContext(),
    maxAge: expiresIn * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureCookieContext(),
  });
}
