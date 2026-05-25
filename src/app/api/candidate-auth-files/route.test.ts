import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/candidate-auth-files", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-candidate-auth-files-"));
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

  it("requires authentication", async () => {
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost/api/candidate-auth-files"));

    expect(response.status).toBe(401);
  });

  it("imports CPA JSON files into the candidate pool", async () => {
    const sqlite = await setupSqlite();
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        files: [
          {
            fileName: "codex-a@example.com-auto.json",
            payload: {
              type: "codex",
              email: "a@example.com",
              refresh_token: "rt_a",
            },
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 1,
      failed: 0,
      results: [
        { fileName: "codex-a@example.com-auto.json", email: "a@example.com", status: "success" },
      ],
    });
    expect(
      sqlite.prepare("SELECT file_name, email, provider, status, raw_json FROM candidate_auth_files").all(),
    ).toEqual([
      {
        file_name: "codex-a@example.com-auto.json",
        email: "a@example.com",
        provider: "codex",
        status: "待刷新",
        raw_json: JSON.stringify({
          type: "codex",
          email: "a@example.com",
          refresh_token: "rt_a",
        }),
      },
    ]);
  });

  it("converts sub2api JSON files before storing candidate auth files", async () => {
    const sqlite = await setupSqlite();
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        files: [
          {
            fileName: "sub2api.json",
            payload: {
              accounts: [
                {
                  platform: "openai",
                  type: "oauth",
                  credentials: {
                    email: "sub@example.com",
                    refresh_token: "rt_sub",
                    expires_at: "2026-05-17T01:00:00Z",
                  },
                },
              ],
            },
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 1,
      failed: 0,
      results: [
        { fileName: "codex-sub@example.com-auto.json", email: "sub@example.com", status: "success" },
      ],
    });
    const row = sqlite
      .prepare("SELECT file_name, email, raw_json FROM candidate_auth_files")
      .get() as { file_name: string; email: string; raw_json: string };
    expect(row.file_name).toBe("codex-sub@example.com-auto.json");
    expect(row.email).toBe("sub@example.com");
    expect(JSON.parse(row.raw_json)).toEqual({
      disabled: false,
      email: "sub@example.com",
      expired: "2026-05-17T01:00:00Z",
      refresh_token: "rt_sub",
      type: "codex",
    });
  });

  it("lists candidate auth files with derived quota metadata", async () => {
    const sqlite = await setupSqlite();
    sqlite
      .prepare(`
        INSERT INTO candidate_auth_files (
          file_name,
          email,
          provider,
          available,
          raw_json,
          quota_raw_json,
          usage_5h_percent,
          usage_week_percent,
          last_quota_refreshed_at,
          created_at,
          updated_at
        )
        VALUES (
          'codex-a@example.com-auto.json',
          'a@example.com',
          'codex',
          1,
          @rawJson,
          @quotaRawJson,
          10,
          20,
          '2026-05-20T01:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T01:00:00.000Z'
        )
      `)
      .run({
        rawJson: JSON.stringify({ email: "a@example.com", type: "codex" }),
        quotaRawJson: JSON.stringify({
          plan_type: "plus",
          rate_limit: {
            primary_window: { reset_after_seconds: 300 },
            secondary_window: { reset_after_seconds: 600 },
          },
        }),
      });
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost/api/candidate-auth-files", {
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authFiles: [
        {
          email: "a@example.com",
          subscriptionType: "plus",
          usage5hPercent: 10,
          usageWeekPercent: 20,
        },
      ],
    });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
