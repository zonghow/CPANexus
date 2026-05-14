import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getAppConfig } from "./config";

const sessionVersion = "v1";
const millisecondsPerDay = 86_400_000;

export function verifyAdminPassword(password: unknown) {
  if (typeof password !== "string" || !password) {
    return false;
  }

  return secureCompare(password, getAppConfig().auth.adminPassword);
}

export function createSessionCookieHeader(options: { now?: number } = {}) {
  const config = getAppConfig();
  const value = createSessionCookieValue(options);
  return `${config.auth.cookieName}=${value}`;
}

export function createSessionSetCookieHeader(options: { now?: number } = {}) {
  const config = getAppConfig();
  const now = options.now ?? Date.now();
  const maxAgeSeconds = config.auth.sessionMaxAgeDays * 24 * 60 * 60;
  const expires = new Date(now + maxAgeSeconds * 1000).toUTCString();
  return serializeCookie(config.auth.cookieName, createSessionCookieValue({ now }), {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: "/",
    sameSite: "Lax",
    expires,
  });
}

export function clearSessionSetCookieHeader() {
  return serializeCookie(getAppConfig().auth.cookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    expires: new Date(0).toUTCString(),
  });
}

export function isAuthenticatedRequest(request: Request) {
  return isAuthenticatedCookieHeader(request.headers.get("cookie"));
}

export function isAuthenticatedCookieHeader(
  cookieHeader: string | null,
  options: { now?: number } = {},
) {
  const config = getAppConfig();
  const token = parseCookies(cookieHeader).get(config.auth.cookieName);
  if (!token) {
    return false;
  }

  const [version, expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (
    version !== sessionVersion ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= (options.now ?? Date.now()) ||
    !signature
  ) {
    return false;
  }

  return secureCompare(signature, signSession(expiresAt));
}

function createSessionCookieValue(options: { now?: number } = {}) {
  const config = getAppConfig();
  const expiresAt =
    (options.now ?? Date.now()) + config.auth.sessionMaxAgeDays * millisecondsPerDay;
  return `${sessionVersion}.${expiresAt}.${signSession(expiresAt)}`;
}

function signSession(expiresAt: number) {
  const password = getAppConfig().auth.adminPassword;
  return createHmac("sha256", `cpa-nexus:${password}`)
    .update(`${sessionVersion}.${expiresAt}`)
    .digest("hex");
}

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    expires: string;
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite: "Lax" | "Strict" | "None";
  },
) {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `Expires=${options.expires}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  return parts.join("; ");
}

function secureCompare(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}
