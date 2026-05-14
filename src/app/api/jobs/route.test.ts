import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/jobs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 14, 14, 51, 30, 0));
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-jobs-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("returns next run metadata for scheduled jobs", async () => {
    const { migrate } = await import("@/db/migrate");
    const { getSqlite } = await import("@/db/client");
    migrate();
    getSqlite()
      .prepare(`
        INSERT INTO job_runs (job_key, status, message, started_at, finished_at)
        VALUES ('auto-replenish', 'success', 'legacy auto replenish run', '2026-05-14T06:00:00.000Z', '2026-05-14T06:00:01.000Z')
      `)
      .run();
    const route = await import("./route");

    const response = await route.GET(
      new Request("http://localhost/api/jobs", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      jobs: Array<{
        key: string;
        enabled: boolean;
        nextRunAt: string | null;
        secondsUntilNextRun: number | null;
      }>;
      runs: Array<{ jobKey: string }>;
    };
    const syncJob = payload.jobs.find((job) => job.key === "sync-cpa-instances");

    expect(payload.jobs.map((job) => job.key)).toEqual(["sync-cpa-instances"]);
    expect(payload.runs.map((run) => run.jobKey)).toEqual([]);
    expect(syncJob).toMatchObject({
      enabled: true,
      secondsUntilNextRun: 510,
    });
    expect(syncJob?.nextRunAt).toBe(new Date(2026, 4, 14, 15, 0, 0, 0).toISOString());
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
