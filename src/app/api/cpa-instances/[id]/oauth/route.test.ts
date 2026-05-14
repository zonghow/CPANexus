import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  startCodexOAuth: vi.fn(),
  submitCodexOAuthCallback: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/cpa-instances/[id]/oauth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-oauth-route-"));
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

  it("starts Codex OAuth for the requested CPA instance", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.startCodexOAuth).mockResolvedValue({
      authUrl: "https://auth.example.com/start",
      state: "oauth-state",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/oauth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "start" }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authUrl: "https://auth.example.com/start",
      state: "oauth-state",
    });
    expect(cpaClient.startCodexOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
    );
  });

  it("submits a Codex OAuth callback URL and syncs the requested CPA instance once", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.submitCodexOAuthCallback).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/oauth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "callback",
          redirectUrl: "https://callback.example.com/?code=abc&state=oauth-state",
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });
    expect(cpaClient.submitCodexOAuthCallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "https://callback.example.com/?code=abc&state=oauth-state",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
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

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
