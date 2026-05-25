import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/candidate-pool-quota", () => ({
  refreshCandidateAuthFileQuota: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/candidate-auth-files/refresh-quotas", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-candidate-quota-"));
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

  it("refreshes every candidate auth file and stores quota snapshots", async () => {
    const sqlite = await setupSqlite();
    insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com");
    const quotaLib = await import("@/lib/candidate-pool-quota");
    vi.mocked(quotaLib.refreshCandidateAuthFileQuota).mockResolvedValue({
      authJson: {
        type: "codex",
        email: "a@example.com",
        access_token: "new_access",
        refresh_token: "rt_a",
      },
      snapshot: {
        authFileName: "codex-a@example.com-auto.json",
        email: "a@example.com",
        usage5hPercent: 25,
        usageWeekPercent: 40,
        available: true,
        exception: null,
        raw: { plan_type: "pro", usage5hPercent: 25, usageWeekPercent: 40 },
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/refresh-quotas", {
      method: "POST",
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      refreshed: 1,
      failed: 0,
      results: [
        {
          fileName: "codex-a@example.com-auto.json",
          email: "a@example.com",
          status: "success",
        },
      ],
    });
    expect(quotaLib.refreshCandidateAuthFileQuota).toHaveBeenCalledWith(
      {
        fileName: "codex-a@example.com-auto.json",
        email: "a@example.com",
        rawJson: JSON.stringify({
          type: "codex",
          email: "a@example.com",
          refresh_token: "rt_a",
        }),
      },
      { refreshAccessToken: true },
    );
    const row = sqlite
      .prepare(`
        SELECT
          available,
          status,
          status_message,
          raw_json,
          quota_raw_json,
          usage_5h_percent,
          usage_week_percent,
          last_quota_refreshed_at
        FROM candidate_auth_files
      `)
      .get() as {
        available: number;
        status: string;
        status_message: string | null;
        raw_json: string;
        quota_raw_json: string;
        usage_5h_percent: number;
        usage_week_percent: number;
        last_quota_refreshed_at: string | null;
      };
    expect(row).toMatchObject({
      available: 1,
      status: "可用",
      status_message: null,
      usage_5h_percent: 25,
      usage_week_percent: 40,
    });
    expect(row.last_quota_refreshed_at).toEqual(expect.any(String));
    expect(JSON.parse(row.raw_json)).toMatchObject({ access_token: "new_access" });
    expect(JSON.parse(row.quota_raw_json)).toMatchObject({ plan_type: "pro" });
  });

  it("can refresh every candidate auth file without refreshing access tokens", async () => {
    const sqlite = await setupSqlite();
    insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com");
    const quotaLib = await import("@/lib/candidate-pool-quota");
    vi.mocked(quotaLib.refreshCandidateAuthFileQuota).mockResolvedValue({
      authJson: {
        type: "codex",
        email: "a@example.com",
        access_token: "old_access",
        refresh_token: "rt_a",
      },
      snapshot: {
        authFileName: "codex-a@example.com-auto.json",
        email: "a@example.com",
        usage5hPercent: 25,
        usageWeekPercent: 40,
        available: true,
        exception: null,
        raw: {},
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/refresh-quotas", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ refreshToken: false }),
    }));

    expect(response.status).toBe(200);
    expect(quotaLib.refreshCandidateAuthFileQuota).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "codex-a@example.com-auto.json",
      }),
      { refreshAccessToken: false },
    );
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertCandidate(sqlite: Database.Database, fileName: string, email: string) {
  sqlite
    .prepare(`
      INSERT INTO candidate_auth_files (
        file_name,
        email,
        provider,
        raw_json,
        created_at,
        updated_at
      )
      VALUES (@fileName, @email, 'codex', @rawJson, '2026-05-20T00:00:00.000Z', '2026-05-20T00:00:00.000Z')
    `)
    .run({
      fileName,
      email,
      rawJson: JSON.stringify({
        type: "codex",
        email,
        refresh_token: "rt_a",
      }),
    });
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
