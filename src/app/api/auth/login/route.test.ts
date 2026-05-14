import { afterEach, describe, expect, it, vi } from "vitest";

describe("/api/auth/login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets a signed session cookie when the password is correct", async () => {
    vi.stubEnv("CPA_NEXUS_ADMIN_PASSWORD", "secret-pass");
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "secret-pass" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("cpa_nexus_session=");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rejects an incorrect password", async () => {
    vi.stubEnv("CPA_NEXUS_ADMIN_PASSWORD", "secret-pass");
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "wrong-pass" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "密码不正确" });
  });
});
