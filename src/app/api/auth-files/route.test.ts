import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/auth-files", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-auth-files-"));
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

  it("returns account tags with auth files", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertAuthFile(sqlite, cpaInstanceId);
    sqlite
      .prepare("INSERT INTO account_tags (account_key, tag) VALUES ('email:a@example.com', 'vip')")
      .run();

    const route = await import("./route");
    const response = await route.GET(
      new Request("http://localhost/api/auth-files", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      groups: [
        {
          authFiles: [
            {
              email: "a@example.com",
              accountTag: "vip",
            },
          ],
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

function insertInstance(sqlite: Database.Database) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES ('target', 'https://target.example.com', 'secret', '/v0/management/auth-files', 1)
    `)
    .run();
  return Number(result.lastInsertRowid);
}

function insertAuthFile(sqlite: Database.Database, cpaInstanceId: number) {
  sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        status,
        available
      )
      VALUES (
        @cpaInstanceId,
        'codex-a@example.com-auto.json',
        'a@example.com',
        'codex',
        'available',
        1
      )
    `)
    .run({ cpaInstanceId });
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
