import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/replenishment-records", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-records-route-"));
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

  it("returns replenishment records newest first", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertRecord(sqlite, {
      source: "quick",
      status: "success",
      cpaInstanceId,
      cpaInstanceName: "target",
      email: "old@example.com",
      authFileName: "codex-old@example.com-auto.json",
      createdAt: "2026-05-13T10:00:00.000Z",
    });
    insertRecord(sqlite, {
      source: "auto",
      status: "error",
      cpaInstanceId,
      cpaInstanceName: "target",
      email: "new@example.com",
      authFileName: "codex-new@example.com-auto.json",
      reasonCodes: JSON.stringify(["available_accounts_below_target"]),
      error: "upload denied",
      createdAt: "2026-05-13T11:00:00.000Z",
    });

    const route = await import("./route");
    const response = await route.GET(
      new Request("http://localhost/api/replenishment-records", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      records: [
        expect.objectContaining({
          source: "auto",
          status: "error",
          cpaInstanceName: "target",
          email: "new@example.com",
          authFileName: "codex-new@example.com-auto.json",
          reasonCodes: "[\"available_accounts_below_target\"]",
          error: "upload denied",
          createdAt: "2026-05-13T11:00:00.000Z",
        }),
        expect.objectContaining({
          source: "quick",
          status: "success",
          cpaInstanceName: "target",
          email: "old@example.com",
          authFileName: "codex-old@example.com-auto.json",
          reasonCodes: null,
          error: null,
          createdAt: "2026-05-13T10:00:00.000Z",
        }),
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

function insertInstance(sqlite: Database.Database) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES ('target', 'https://target.example.com', 'secret', '/v0/management/auth-files', 1)
    `)
    .run();
  return Number(result.lastInsertRowid);
}

function insertRecord(
  sqlite: Database.Database,
  record: {
    source: string;
    status: string;
    cpaInstanceId: number;
    cpaInstanceName: string;
    email: string;
    authFileName: string;
    reasonCodes?: string | null;
    error?: string | null;
    createdAt: string;
  },
) {
  sqlite
    .prepare(`
      INSERT INTO replenishment_records (
        source,
        status,
        cpa_instance_id,
        cpa_instance_name,
        email,
        auth_file_name,
        reason_codes,
        error,
        created_at
      )
      VALUES (
        @source,
        @status,
        @cpaInstanceId,
        @cpaInstanceName,
        @email,
        @authFileName,
        @reasonCodes,
        @error,
        @createdAt
      )
    `)
    .run({
      ...record,
      reasonCodes: record.reasonCodes ?? null,
      error: record.error ?? null,
    });
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
