import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/jobs/[key]/run", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-job-run-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("returns a conflict when the job is already running", async () => {
    const { migrate } = await import("@/db/migrate");
    const { getSqlite } = await import("@/db/client");
    migrate();
    getSqlite()
      .prepare(`
        INSERT INTO job_runs (job_key, status, message, started_at, finished_at)
        VALUES ('sync-cpa-instances', 'running', '同步中', '2026-05-14T06:51:00.000Z', NULL)
      `)
      .run();
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/jobs/sync-cpa-instances/run", {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ key: "sync-cpa-instances" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "当前有同步任务正在进行中",
    });
  });
});

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: {
      close: () => void;
    };
  };
}
