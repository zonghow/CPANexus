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

vi.mock("@/lib/candidate-pool-quota", () => ({
  refreshCandidateAuthFileQuota: vi.fn(),
  refreshCandidateAuthFileToken: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/candidate-auth-files/batch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-candidate-batch-"));
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

  it("exports selected candidate auth files as a zip", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com");
    const secondId = insertCandidate(sqlite, "codex-b@example.com-auto.json", "b@example.com");
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "export",
        authFileIds: [firstId, secondId],
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="candidate-auths-\d{8}-\d{6}\.zip"$/);
    const archive = Buffer.from(await response.arrayBuffer());
    expect(readZipEntries(archive)).toEqual([
      {
        name: "codex-a@example.com-auto.json",
        data: `${JSON.stringify({ type: "codex", email: "a@example.com" }, null, 2)}\n`,
      },
      {
        name: "codex-b@example.com-auto.json",
        data: `${JSON.stringify({ type: "codex", email: "b@example.com" }, null, 2)}\n`,
      },
    ]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM candidate_auth_files").get()).toMatchObject({ count: 2 });
  });

  it("exports and deletes selected candidate auth files", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com");
    insertCandidate(sqlite, "codex-b@example.com-auto.json", "b@example.com");
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "exportAndDelete",
        authFileIds: [firstId],
      }),
    }));

    expect(response.status).toBe(200);
    expect(readZipEntries(Buffer.from(await response.arrayBuffer()))).toEqual([
      {
        name: "codex-a@example.com-auto.json",
        data: `${JSON.stringify({ type: "codex", email: "a@example.com" }, null, 2)}\n`,
      },
    ]);
    expect(sqlite.prepare("SELECT file_name FROM candidate_auth_files").all()).toEqual([
      { file_name: "codex-b@example.com-auto.json" },
    ]);
  });

  it("moves selected candidate auth files to a CPA and deletes them locally", async () => {
    const sqlite = await setupSqlite();
    const targetId = insertInstance(sqlite, "target");
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com");
    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "move",
        authFileIds: [firstId],
        targetCpaInstanceId: targetId,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      action: "move",
      processed: 1,
    });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: targetId }),
      "codex-a@example.com-auto.json",
      { type: "codex", email: "a@example.com" },
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(targetId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM candidate_auth_files").get()).toMatchObject({ count: 0 });
  });

  it("force refreshes selected candidate refresh tokens and stores rotated tokens", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com", {
      type: "codex",
      email: "a@example.com",
      refresh_token: "rt_old",
    });
    const quotaLib = await import("@/lib/candidate-pool-quota");
    vi.mocked(quotaLib.refreshCandidateAuthFileToken).mockResolvedValue({
      email: "a@example.com",
      refreshTokenRotated: true,
      authJson: {
        type: "codex",
        email: "a@example.com",
        access_token: "access_new",
        refresh_token: "rt_new",
        expired: "2026-05-20T01:00:00Z",
        last_refresh: "2026-05-20T00:00:00Z",
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "refreshToken",
        authFileIds: [firstId],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      action: "refreshToken",
      processed: 1,
      failed: 0,
      rotated: 1,
    });
    expect(quotaLib.refreshCandidateAuthFileToken).toHaveBeenCalledWith({
      fileName: "codex-a@example.com-auto.json",
      email: "a@example.com",
      rawJson: JSON.stringify({
        type: "codex",
        email: "a@example.com",
        refresh_token: "rt_old",
      }),
    });
    const row = sqlite
      .prepare("SELECT status, status_message, raw_json FROM candidate_auth_files WHERE id = ?")
      .get(firstId) as { status: string; status_message: string | null; raw_json: string };
    expect(row.status).toBe("待刷新");
    expect(row.status_message).toBeNull();
    expect(JSON.parse(row.raw_json)).toMatchObject({
      access_token: "access_new",
      refresh_token: "rt_new",
    });
  });

  it("clears stale RT refresh errors after a selected token refresh succeeds", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com", {
      type: "codex",
      email: "a@example.com",
      refresh_token: "rt_old",
    });
    sqlite
      .prepare("UPDATE candidate_auth_files SET status = '刷新RT失败', status_message = 'bad rt' WHERE id = ?")
      .run(firstId);
    const quotaLib = await import("@/lib/candidate-pool-quota");
    vi.mocked(quotaLib.refreshCandidateAuthFileToken).mockResolvedValue({
      email: "a@example.com",
      refreshTokenRotated: false,
      authJson: {
        type: "codex",
        email: "a@example.com",
        access_token: "access_new",
        refresh_token: "rt_old",
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "refreshToken",
        authFileIds: [firstId],
      }),
    }));

    expect(response.status).toBe(200);
    const row = sqlite
      .prepare("SELECT status, status_message, raw_json FROM candidate_auth_files WHERE id = ?")
      .get(firstId) as { status: string | null; status_message: string | null; raw_json: string };
    expect(row.status).toBeNull();
    expect(row.status_message).toBeNull();
    expect(JSON.parse(row.raw_json)).toMatchObject({
      access_token: "access_new",
      refresh_token: "rt_old",
    });
  });

  it("refreshes selected candidate quotas and stores quota snapshots", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com", {
      type: "codex",
      email: "a@example.com",
      refresh_token: "rt_a",
    });
    insertCandidate(sqlite, "codex-b@example.com-auto.json", "b@example.com", {
      type: "codex",
      email: "b@example.com",
      refresh_token: "rt_b",
    });
    const quotaLib = await import("@/lib/candidate-pool-quota");
    vi.mocked(quotaLib.refreshCandidateAuthFileQuota).mockResolvedValue({
      authJson: {
        type: "codex",
        email: "a@example.com",
        access_token: "access_new",
        refresh_token: "rt_a",
      },
      snapshot: {
        authFileName: "codex-a@example.com-auto.json",
        email: "a@example.com",
        usage5hPercent: 30,
        usageWeekPercent: 50,
        available: true,
        exception: null,
        raw: { plan_type: "plus", usage_5h_percent: 30 },
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "refreshQuota",
        authFileIds: [firstId],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      action: "refreshQuota",
      processed: 1,
      failed: 0,
    });
    expect(quotaLib.refreshCandidateAuthFileQuota).toHaveBeenCalledOnce();
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
    const rows = sqlite
      .prepare(`
        SELECT
          file_name,
          available,
          status,
          raw_json,
          quota_raw_json,
          usage_5h_percent,
          usage_week_percent,
          last_quota_refreshed_at
        FROM candidate_auth_files
        ORDER BY file_name
      `)
      .all() as Array<{
        file_name: string;
        available: number | null;
        status: string | null;
        raw_json: string;
        quota_raw_json: string | null;
        usage_5h_percent: number | null;
        usage_week_percent: number | null;
        last_quota_refreshed_at: string | null;
      }>;
    expect(rows[0]).toMatchObject({
      file_name: "codex-a@example.com-auto.json",
      available: 1,
      status: "可用",
      usage_5h_percent: 30,
      usage_week_percent: 50,
    });
    expect(rows[0].last_quota_refreshed_at).toEqual(expect.any(String));
    expect(JSON.parse(rows[0].raw_json)).toMatchObject({ access_token: "access_new" });
    expect(JSON.parse(rows[0].quota_raw_json ?? "{}")).toMatchObject({ plan_type: "plus" });
    expect(rows[1]).toMatchObject({
      file_name: "codex-b@example.com-auto.json",
      usage_5h_percent: null,
      last_quota_refreshed_at: null,
    });
  });

  it("refreshes selected candidate quotas without refreshing access tokens", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertCandidate(sqlite, "codex-a@example.com-auto.json", "a@example.com", {
      type: "codex",
      email: "a@example.com",
      access_token: "old_access",
      refresh_token: "rt_a",
    });
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
        usage5hPercent: 30,
        usageWeekPercent: 50,
        available: true,
        exception: null,
        raw: {},
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request("http://localhost/api/candidate-auth-files/batch", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "refreshQuota",
        authFileIds: [firstId],
        refreshToken: false,
      }),
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

function insertInstance(sqlite: Database.Database, name: string) {
  return Number(
    sqlite
      .prepare(`
        INSERT INTO cpa_instances (name, base_url, password, enabled)
        VALUES (?, ?, 'secret', 1)
      `)
      .run(name, `https://${name}.example.com`).lastInsertRowid,
  );
}

function insertCandidate(
  sqlite: Database.Database,
  fileName: string,
  email: string,
  payload: Record<string, unknown> = { type: "codex", email },
) {
  return Number(
    sqlite
      .prepare(`
        INSERT INTO candidate_auth_files (
          file_name,
          email,
          provider,
          status,
          raw_json,
          created_at,
          updated_at
        )
        VALUES (@fileName, @email, 'codex', '待刷新', @rawJson, '2026-05-20T00:00:00.000Z', '2026-05-20T00:00:00.000Z')
      `)
      .run({
        fileName,
        email,
        rawJson: JSON.stringify(payload),
      }).lastInsertRowid,
  );
}

function readZipEntries(archive: Buffer) {
  const entries: Array<{ name: string; data: string }> = [];
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    entries.push({
      name: archive.subarray(nameStart, nameStart + fileNameLength).toString("utf8"),
      data: archive.subarray(dataStart, dataStart + compressedSize).toString("utf8"),
    });
    offset = dataStart + compressedSize;
  }

  return entries;
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
