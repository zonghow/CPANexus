import { describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    initRequestDb: vi.fn(),
  };
});

vi.mock("@/lib/jobs", () => ({
  isCpaInstanceAlreadySyncingError: (error: unknown) =>
    error instanceof Error && error.name === "CpaInstanceAlreadySyncingError",
  syncCpaInstanceById: vi.fn(),
}));

describe("/api/cpa-instances/[id]/sync", () => {
  it("syncs only the requested CPA instance", async () => {
    const jobs = await import("@/lib/jobs");
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 2 auth files, 2 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/42/sync", {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "success",
      message: "synced 2 auth files, 2 quota snapshots",
      instance: "source",
    });
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(42);
  });

  it("returns a conflict when the CPA instance is already syncing", async () => {
    const jobs = await import("@/lib/jobs");
    const error = new Error("CPA source 正在同步中");
    error.name = "CpaInstanceAlreadySyncingError";
    vi.mocked(jobs.syncCpaInstanceById).mockRejectedValue(error);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/42/sync", {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "CPA source 正在同步中",
    });
  });
});

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
