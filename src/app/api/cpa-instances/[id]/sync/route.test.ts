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
});

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
