import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/exception-auth-files", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-exception-auth-files-"));
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

  it("lists exception auth files newest first", async () => {
    const sqlite = await setupSqlite();
    insertExceptionAuthFile(sqlite, "older@example.com", "older.json", "2026-05-20T01:00:00.000Z");
    insertExceptionAuthFile(sqlite, "newer@example.com", "newer.json", "2026-05-21T01:00:00.000Z");
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost/api/exception-auth-files", {
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      exceptionAuthFiles: [
        { email: "newer@example.com", fileName: "newer.json" },
        { email: "older@example.com", fileName: "older.json" },
      ],
    });
  });

  it("clears all exception auth files", async () => {
    const sqlite = await setupSqlite();
    insertExceptionAuthFile(sqlite, "a@example.com", "a.json");
    insertExceptionAuthFile(sqlite, "b@example.com", "b.json");
    const route = await import("./route");

    const response = await route.DELETE(new Request("http://localhost/api/exception-auth-files", {
      method: "DELETE",
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", deleted: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 0 });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertExceptionAuthFile(
  sqlite: Database.Database,
  email: string,
  fileName: string,
  createdAt = "2026-05-20T01:00:00.000Z",
) {
  sqlite
    .prepare(`
      INSERT INTO exception_auth_files (
        source_cpa_instance_name,
        file_name,
        email,
        last_error,
        raw_json,
        created_at,
        updated_at
      )
      VALUES ('source', @fileName, @email, 'bad token', @rawJson, @createdAt, @createdAt)
    `)
    .run({ email, fileName, rawJson: JSON.stringify({ email }), createdAt });
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
