import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/quotas", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-quotas-"));
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

  it("keeps quota snapshots separate for auth files with the same email", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "codex-shared-1.json",
      email: "shared@example.com",
      usage5hPercent: 11,
      usageWeekPercent: 21,
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "codex-shared-2.json",
      email: "shared@example.com",
      usage5hPercent: 77,
      usageWeekPercent: 87,
    });

    const route = await import("./route");
    const response = await route.GET(
      new Request("http://localhost/api/quotas", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      groups: Array<{ quotas: Array<{
        authFileName: string | null;
        email: string | null;
        usage5hPercent: number | null;
        usageWeekPercent: number | null;
      }> }>;
    };
    const quotas = payload.groups[0]?.quotas
      .map((quota) => ({
        authFileName: quota.authFileName,
        email: quota.email,
        usage5hPercent: quota.usage5hPercent,
        usageWeekPercent: quota.usageWeekPercent,
      }))
      .sort((a, b) => String(a.authFileName).localeCompare(String(b.authFileName)));

    expect(quotas).toEqual([
      {
        authFileName: "codex-shared-1.json",
        email: "shared@example.com",
        usage5hPercent: 11,
        usageWeekPercent: 21,
      },
      {
        authFileName: "codex-shared-2.json",
        email: "shared@example.com",
        usage5hPercent: 77,
        usageWeekPercent: 87,
      },
    ]);
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES ('target', 'https://target.example.com', 'secret', '/v0/management/auth-files', 1)
    `)
    .run();
  return Number(result.lastInsertRowid);
}

function insertQuotaSnapshot(
  sqlite: Database.Database,
  cpaInstanceId: number,
  input: {
    authFileName: string;
    email: string;
    usage5hPercent: number;
    usageWeekPercent: number;
  },
) {
  sqlite
    .prepare(`
      INSERT INTO quota_snapshots (
        cpa_instance_id,
        auth_file_name,
        email,
        usage_5h_percent,
        usage_week_percent,
        available,
        captured_at
      )
      VALUES (
        @cpaInstanceId,
        @authFileName,
        @email,
        @usage5hPercent,
        @usageWeekPercent,
        1,
        '2026-05-13T00:00:00.000Z'
      )
    `)
    .run({ cpaInstanceId, ...input });
}

function authHeaders() {
  return {
    cookie: createSessionCookieHeader(),
  };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
