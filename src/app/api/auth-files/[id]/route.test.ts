import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  deleteRemoteAuthFile: vi.fn(),
  downloadRemoteAuthFile: vi.fn(),
  patchRemoteAuthFileFields: vi.fn(),
  setRemoteAuthFileDisabled: vi.fn(),
  uploadRemoteAuthFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  refreshAuthFileQuotaById: vi.fn(),
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/auth-files/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-route-"));
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

  it("deletes the remote auth file and removes local related records", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);
    insertQuotaSnapshot(sqlite, sourceId);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 0 auth files, 0 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.DELETE(
      new Request("http://localhost/api/auth-files/1", {
        headers: authHeaders(),
      }),
      {
        params: Promise.resolve({ id: String(authFileId) }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sourceId,
        name: "source",
        baseUrl: "https://source.example.com",
      }),
      "codex-a@example.com-auto.json",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM quota_snapshots").get()).toMatchObject({ count: 0 });
  });

  it("moves an auth file by uploading to the target CPA before deleting from the source CPA", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const targetId = insertInstance(sqlite, {
      name: "target",
      baseUrl: "https://target.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);
    insertQuotaSnapshot(sqlite, sourceId);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockRejectedValue(new Error("remote download failed"));
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "synced",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ targetCpaInstanceId: targetId }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    expect(cpaClient.downloadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
    );
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: targetId }),
      "codex-a@example.com-auto.json",
      { email: "a@example.com", refresh_token: "rt_test" },
    );
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(targetId);
    expect(sqlite.prepare("SELECT cpa_instance_id, status, available FROM auth_files WHERE id = ?").get(authFileId)).toMatchObject({
      cpa_instance_id: targetId,
      status: "待配额刷新",
      available: 0,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM quota_snapshots").get()).toMatchObject({ count: 0 });
  });

  it("disables an auth file through the CPA status endpoint and updates local status", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.setRemoteAuthFileDisabled).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ disabled: true }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
      true,
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(
      sqlite
        .prepare("SELECT disabled, available, status, status_message FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toMatchObject({
      disabled: 1,
      available: 0,
      status: "已停用",
      status_message: "手动停用",
    });
  });

  it("enables a disabled auth file through the CPA status endpoint and waits for quota refresh", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId, { disabled: true });

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.setRemoteAuthFileDisabled).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ disabled: false }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
      false,
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(
      sqlite
        .prepare("SELECT disabled, available, status, status_message FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toMatchObject({
      disabled: 0,
      available: 0,
      status: "待配额刷新",
      status_message: "已启用，等待配额刷新",
    });
  });

  it("configures an auth file proxy through the CPA fields endpoint", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);
    const proxyUrl = "socks5://proxy-user:proxy-pass@127.0.0.1:1080/";
    insertProxy(sqlite, sourceId, proxyUrl);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.patchRemoteAuthFileFields).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ proxyUrl }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    expect(cpaClient.patchRemoteAuthFileFields).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
      { proxy_url: proxyUrl },
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(
      sqlite
        .prepare("SELECT proxy_url, json_extract(raw_json, '$.proxy_url') AS raw_proxy_url FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toEqual({
      proxy_url: proxyUrl,
      raw_proxy_url: proxyUrl,
    });
  });

  it("clears an auth file proxy with an empty CPA field value", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const proxyUrl = "socks5://proxy-user:proxy-pass@127.0.0.1:1080/";
    const authFileId = insertAuthFile(sqlite, sourceId, { proxyUrl });

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.patchRemoteAuthFileFields).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ proxyUrl: null }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    expect(cpaClient.patchRemoteAuthFileFields).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
      { proxy_url: "" },
    );
    expect(
      sqlite
        .prepare("SELECT proxy_url, json_extract(raw_json, '$.proxy_url') AS raw_proxy_url FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toEqual({
      proxy_url: null,
      raw_proxy_url: null,
    });
  });

  it("keeps a successful disable response when the post-operation sync reports failure", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.setRemoteAuthFileDisabled).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "error",
      message: "quota refresh failed",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ disabled: true }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      sync: {
        status: "error",
        message: "quota refresh failed",
      },
    });
    expect(
      sqlite
        .prepare("SELECT disabled, status, status_message FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toMatchObject({
      disabled: 1,
      status: "已停用",
      status_message: "手动停用",
    });
  });

  it("refreshes quota for the selected auth file", async () => {
    const jobs = await import("@/lib/jobs");
    vi.mocked(jobs.refreshAuthFileQuotaById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "refreshed 1 quota snapshot",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/auth-files/42", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "refreshQuota" }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      instance: "source",
      status: "success",
      message: "refreshed 1 quota snapshot",
    });
    expect(jobs.refreshAuthFileQuotaById).toHaveBeenCalledWith(42);
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(
  sqlite: Database.Database,
  overrides: { name: string; baseUrl: string },
) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES (@name, @baseUrl, 'secret', '/v0/management/auth-files', 1)
    `)
    .run(overrides);
  return Number(result.lastInsertRowid);
}

function insertAuthFile(
  sqlite: Database.Database,
  cpaInstanceId: number,
  options: { disabled?: boolean; proxyUrl?: string } = {},
) {
  const result = sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        status,
        disabled,
        available,
        proxy_url,
        raw_json
      )
      VALUES (
        @cpaInstanceId,
        'codex-a@example.com-auto.json',
        'a@example.com',
        'codex',
        'available',
        @disabled,
        1,
        @proxyUrl,
        @rawJson
      )
    `)
    .run({
      cpaInstanceId,
      disabled: options.disabled ? 1 : 0,
      proxyUrl: options.proxyUrl ?? null,
      rawJson: JSON.stringify({
        email: "a@example.com",
        refresh_token: "rt_test",
        ...(options.proxyUrl ? { proxy_url: options.proxyUrl } : {}),
      }),
    });
  return Number(result.lastInsertRowid);
}

function insertQuotaSnapshot(sqlite: Database.Database, cpaInstanceId: number) {
  sqlite
    .prepare(`
      INSERT INTO quota_snapshots (
        cpa_instance_id,
        auth_file_name,
        email,
        usage_5h_percent,
        usage_week_percent,
        available
      )
      VALUES (
        @cpaInstanceId,
        'codex-a@example.com-auto.json',
        'a@example.com',
        12,
        34,
        1
      )
    `)
    .run({ cpaInstanceId });
}

function insertProxy(sqlite: Database.Database, cpaInstanceId: number, url: string) {
  const proxyId = Number(
    sqlite
      .prepare(`
        INSERT INTO proxies (name, url, max_auth_files, enabled)
        VALUES ('proxy-a', @url, 10, 1)
      `)
      .run({ url }).lastInsertRowid,
  );
  sqlite
    .prepare(`
      INSERT INTO proxy_cpa_instances (proxy_id, cpa_instance_id)
      VALUES (@proxyId, @cpaInstanceId)
    `)
    .run({ proxyId, cpaInstanceId });
  return proxyId;
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
