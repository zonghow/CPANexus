import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAdminPassword = process.env.CPA_NEXUS_ADMIN_PASSWORD;
let tempDir: string | null = null;

describe("/api/openapi/candidate-auth-files", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-openapi-candidate-auth-files-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    process.env.CPA_NEXUS_ADMIN_PASSWORD = "secret-pass";
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
    if (originalAdminPassword === undefined) {
      delete process.env.CPA_NEXUS_ADMIN_PASSWORD;
    } else {
      process.env.CPA_NEXUS_ADMIN_PASSWORD = originalAdminPassword;
    }
  });

  it("requires a bearer admin password", async () => {
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/openapi/candidate-auth-files", {
      method: "POST",
      body: JSON.stringify([]),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(401);
  });

  it("imports candidate auth files from a JSON array", async () => {
    const sqlite = await setupSqlite();
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/openapi/candidate-auth-files", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-pass",
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          type: "codex",
          email: "a@example.com",
          refresh_token: "rt_a",
        },
        {
          platform: "openai",
          type: "oauth",
          credentials: {
            email: "sub@example.com",
            refresh_token: "rt_sub",
            expires_at: "2026-05-17T01:00:00Z",
          },
        },
      ]),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 2,
      failed: 0,
      results: [
        { fileName: "codex-a@example.com-auto.json", email: "a@example.com", status: "success" },
        { fileName: "codex-sub@example.com-auto.json", email: "sub@example.com", status: "success" },
      ],
    });
    const rows = sqlite
      .prepare("SELECT file_name, email, status, raw_json FROM candidate_auth_files ORDER BY file_name")
      .all() as Array<{ file_name: string; email: string; status: string; raw_json: string }>;
    expect(rows.map((row) => ({
      fileName: row.file_name,
      email: row.email,
      status: row.status,
      payload: JSON.parse(row.raw_json) as unknown,
    }))).toEqual([
      {
        fileName: "codex-a@example.com-auto.json",
        email: "a@example.com",
        status: "待刷新",
        payload: {
          type: "codex",
          email: "a@example.com",
          refresh_token: "rt_a",
        },
      },
      {
        fileName: "codex-sub@example.com-auto.json",
        email: "sub@example.com",
        status: "待刷新",
        payload: {
          disabled: false,
          email: "sub@example.com",
          expired: "2026-05-17T01:00:00Z",
          refresh_token: "rt_sub",
          type: "codex",
        },
      },
    ]);
  });

  it("imports candidate auth files from multipart JSON files", async () => {
    const sqlite = await setupSqlite();
    const formData = new FormData();
    formData.append(
      "files",
      new Blob([
        JSON.stringify({
          type: "codex",
          email: "file@example.com",
          refresh_token: "rt_file",
        }),
      ], { type: "application/json" }),
      "from-file.json",
    );
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/openapi/candidate-auth-files", {
      method: "POST",
      headers: { authorization: "Bearer secret-pass" },
      body: formData,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 1,
      failed: 0,
      results: [
        { fileName: "from-file.json", email: "file@example.com", status: "success" },
      ],
    });
    expect(
      sqlite.prepare("SELECT file_name, email FROM candidate_auth_files").get(),
    ).toEqual({ file_name: "from-file.json", email: "file@example.com" });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
