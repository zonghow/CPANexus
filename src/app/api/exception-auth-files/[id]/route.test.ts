import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  uploadRemoteAuthFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/exception-auth-files/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-exception-auth-file-"));
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

  it("deletes one exception auth file", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertExceptionAuthFile(sqlite, "first@example.com", "first.json");
    insertExceptionAuthFile(sqlite, "second@example.com", "second.json");
    const route = await import("./route");

    const response = await route.DELETE(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "DELETE",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: String(firstId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(sqlite.prepare("SELECT file_name FROM exception_auth_files").all()).toEqual([
      { file_name: "second.json" },
    ]);
  });

  it("moves an exception auth file to a target CPA", async () => {
    const sqlite = await setupSqlite();
    const targetId = insertInstance(sqlite, "target", "https://target.example.com");
    const exceptionId = insertExceptionAuthFile(
      sqlite,
      "move@example.com",
      "move.json",
      JSON.stringify({ email: "move@example.com", refresh_token: "rt_move" }),
    );

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ targetCpaInstanceId: targetId }),
      }),
      { params: Promise.resolve({ id: String(exceptionId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: targetId }),
      "move.json",
      { email: "move@example.com", refresh_token: "rt_move" },
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(targetId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 0 });
  });

  it("keeps the exception auth file when target CPA already has the same file name", async () => {
    const sqlite = await setupSqlite();
    const targetId = insertInstance(sqlite, "target", "https://target.example.com");
    const exceptionId = insertExceptionAuthFile(sqlite, "move@example.com", "move.json");
    insertAuthFile(sqlite, targetId, "move.json");

    const cpaClient = await import("@/lib/cpa-client");
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ targetCpaInstanceId: targetId }),
      }),
      { params: Promise.resolve({ id: String(exceptionId) }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "target CPA already has auth file move.json",
    });
    expect(cpaClient.uploadRemoteAuthFile).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 1 });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database, name: string, baseUrl: string) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES (@name, @baseUrl, 'secret', '/v0/management/auth-files', 1)
    `)
    .run({ name, baseUrl });
  return Number(result.lastInsertRowid);
}

function insertExceptionAuthFile(
  sqlite: Database.Database,
  email: string,
  fileName: string,
  rawJson = JSON.stringify({ email }),
) {
  const result = sqlite
    .prepare(`
      INSERT INTO exception_auth_files (
        source_cpa_instance_name,
        file_name,
        email,
        last_error,
        raw_json
      )
      VALUES ('source', @fileName, @email, 'bad token', @rawJson)
    `)
    .run({ email, fileName, rawJson });
  return Number(result.lastInsertRowid);
}

function insertAuthFile(sqlite: Database.Database, cpaInstanceId: number, fileName: string) {
  sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        status,
        disabled,
        available,
        raw_json
      )
      VALUES (@cpaInstanceId, @fileName, 'move@example.com', 'codex', 'available', 0, 1, '{}')
    `)
    .run({ cpaInstanceId, fileName });
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
