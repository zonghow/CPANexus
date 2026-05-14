import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSessionCookieHeader,
  isAuthenticatedCookieHeader,
  verifyAdminPassword,
} from "./auth";

describe("admin auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the configured admin password", () => {
    vi.stubEnv("CPA_NEXUS_ADMIN_PASSWORD", "secret-pass");

    expect(verifyAdminPassword("secret-pass")).toBe(true);
    expect(verifyAdminPassword("wrong-pass")).toBe(false);
  });

  it("accepts a signed non-expired session cookie", () => {
    vi.stubEnv("CPA_NEXUS_ADMIN_PASSWORD", "secret-pass");
    vi.stubEnv("CPA_NEXUS_COOKIE_NAME", "custom_session");
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);

    const cookieHeader = createSessionCookieHeader({ now });

    expect(isAuthenticatedCookieHeader(cookieHeader, { now })).toBe(true);
  });

  it("rejects tampered session cookies", () => {
    vi.stubEnv("CPA_NEXUS_ADMIN_PASSWORD", "secret-pass");
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    const cookieHeader = createSessionCookieHeader({ now }).replace(/[a-f0-9]$/, "0");

    expect(isAuthenticatedCookieHeader(cookieHeader, { now })).toBe(false);
  });
});
