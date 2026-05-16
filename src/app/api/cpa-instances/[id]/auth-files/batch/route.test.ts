import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  deleteRemoteAuthFile: vi.fn(),
  patchRemoteAuthFileFields: vi.fn(),
  setRemoteAuthFileDisabled: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/cpa-instances/[id]/auth-files/batch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-batch-auth-files-"));
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

  it("deletes selected auth files from CPA and local records, then syncs once", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const firstId = insertAuthFile(sqlite, cpaInstanceId, "codex-first@example.com-auto.json");
    const secondId = insertAuthFile(sqlite, cpaInstanceId, "codex-second@example.com-auto.json");
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-first@example.com-auto.json");
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-second@example.com-auto.json");

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "delete", authFileIds: [firstId, secondId] }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      processed: 2,
      action: "delete",
    });
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledTimes(2);
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-first@example.com-auto.json",
    );
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-second@example.com-auto.json",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM quota_snapshots").get()).toMatchObject({ count: 0 });
  });

  it("disables selected auth files through CPA status endpoint, then syncs once", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const firstId = insertAuthFile(sqlite, cpaInstanceId, "codex-first@example.com-auto.json");
    const secondId = insertAuthFile(sqlite, cpaInstanceId, "codex-second@example.com-auto.json");

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.setRemoteAuthFileDisabled).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "disable", authFileIds: [firstId, secondId] }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      processed: 2,
      action: "disable",
    });
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenCalledTimes(2);
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-first@example.com-auto.json",
      true,
    );
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-second@example.com-auto.json",
      true,
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .prepare("SELECT disabled, available, status, status_message FROM auth_files ORDER BY id")
        .all(),
    ).toEqual([
      {
        disabled: 1,
        available: 0,
        status: "已停用",
        status_message: "批量停用异常账号",
      },
      {
        disabled: 1,
        available: 0,
        status: "已停用",
        status_message: "批量停用异常账号",
      },
    ]);
  });

  it("deletes only free auth files when the free target is requested", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const freeId = insertAuthFile(sqlite, cpaInstanceId, "codex-free@example.com-auto.json");
    const plusId = insertAuthFile(sqlite, cpaInstanceId, "codex-plus@example.com-auto.json");
    const unknownId = insertAuthFile(sqlite, cpaInstanceId, "codex-unknown@example.com-auto.json");
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-free@example.com-auto.json", {
      rawJson: JSON.stringify({ plan_type: "free" }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-plus@example.com-auto.json", {
      rawJson: JSON.stringify({ plan_type: "plus" }),
    });

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "delete", target: "free" }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      processed: 1,
      action: "delete",
    });
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledTimes(1);
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-free@example.com-auto.json",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(
      sqlite.prepare("SELECT id, file_name FROM auth_files ORDER BY id").all(),
    ).toEqual([
      { id: plusId, file_name: "codex-plus@example.com-auto.json" },
      { id: unknownId, file_name: "codex-unknown@example.com-auto.json" },
    ]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files WHERE id = @freeId").get({ freeId })).toMatchObject({
      count: 0,
    });
  });

  it("disables only active free auth files when the free target is requested", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const activeFreeId = insertAuthFile(sqlite, cpaInstanceId, "codex-active-free@example.com-auto.json");
    const disabledFreeId = insertAuthFile(sqlite, cpaInstanceId, "codex-disabled-free@example.com-auto.json", {
      disabled: true,
    });
    const plusId = insertAuthFile(sqlite, cpaInstanceId, "codex-plus@example.com-auto.json");
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-active-free@example.com-auto.json", {
      rawJson: JSON.stringify({ rate_limit: { plan_type: "free" } }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-disabled-free@example.com-auto.json", {
      rawJson: JSON.stringify({ plan_type: "free" }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-plus@example.com-auto.json", {
      rawJson: JSON.stringify({ plan_type: "plus" }),
    });

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.setRemoteAuthFileDisabled).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "disable", target: "free" }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      processed: 1,
      action: "disable",
    });
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenCalledTimes(1);
    expect(cpaClient.setRemoteAuthFileDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-active-free@example.com-auto.json",
      true,
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .prepare("SELECT id, disabled, available, status, status_message FROM auth_files ORDER BY id")
        .all(),
    ).toEqual([
      {
        id: activeFreeId,
        disabled: 1,
        available: 0,
        status: "已停用",
        status_message: "批量停用Free号",
      },
      {
        id: disabledFreeId,
        disabled: 1,
        available: 0,
        status: "异常",
        status_message: "bad token",
      },
      {
        id: plusId,
        disabled: 0,
        available: 0,
        status: "异常",
        status_message: "bad token",
      },
    ]);
  });

  it("auto assigns allowed enabled proxies without exceeding their account capacity", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertAuthFile(sqlite, cpaInstanceId, "codex-has-proxy@example.com-auto.json", {
      proxyUrl: "http://proxy-a.example.com:8080",
    });
    const firstUnassignedId = insertAuthFile(
      sqlite,
      cpaInstanceId,
      "codex-first@example.com-auto.json",
      { rawJson: JSON.stringify({ type: "codex", email: "first@example.com" }) },
    );
    const secondUnassignedId = insertAuthFile(
      sqlite,
      cpaInstanceId,
      "codex-second@example.com-auto.json",
    );
    const skippedId = insertAuthFile(sqlite, cpaInstanceId, "codex-skipped@example.com-auto.json");
    const proxyAId = insertProxy(sqlite, "proxy-a", "http://proxy-a.example.com:8080", 2);
    const proxyBId = insertProxy(sqlite, "proxy-b", "http://proxy-b.example.com:8080", 1);
    const notAllowedProxyId = insertProxy(sqlite, "not-allowed", "http://not-allowed.example.com:8080", 10);
    const disabledProxyId = insertProxy(sqlite, "disabled", "http://disabled.example.com:8080", 10, false);
    linkProxyToCpa(sqlite, proxyAId, cpaInstanceId);
    linkProxyToCpa(sqlite, proxyBId, cpaInstanceId);
    linkProxyToCpa(sqlite, disabledProxyId, cpaInstanceId);
    expect(notAllowedProxyId).toBeGreaterThan(0);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.patchRemoteAuthFileFields).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "autoAssignProxy" }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      action: "autoAssignProxy",
      processed: 2,
      skipped: 1,
    });
    expect(cpaClient.patchRemoteAuthFileFields).toHaveBeenCalledTimes(2);
    expect(cpaClient.patchRemoteAuthFileFields).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-first@example.com-auto.json",
      { proxy_url: "http://proxy-a.example.com:8080" },
    );
    expect(cpaClient.patchRemoteAuthFileFields).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-second@example.com-auto.json",
      { proxy_url: "http://proxy-b.example.com:8080" },
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);

    const rows = sqlite
      .prepare("SELECT id, proxy_url, raw_json FROM auth_files ORDER BY id")
      .all() as Array<{ id: number; proxy_url: string | null; raw_json: string | null }>;
    expect(rows.find((row) => row.id === firstUnassignedId)?.proxy_url).toBe(
      "http://proxy-a.example.com:8080",
    );
    expect(JSON.parse(rows.find((row) => row.id === firstUnassignedId)?.raw_json ?? "{}")).toMatchObject({
      email: "first@example.com",
      proxy_url: "http://proxy-a.example.com:8080",
    });
    expect(rows.find((row) => row.id === secondUnassignedId)?.proxy_url).toBe(
      "http://proxy-b.example.com:8080",
    );
    expect(rows.find((row) => row.id === skippedId)?.proxy_url).toBeNull();
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

function insertAuthFile(
  sqlite: Database.Database,
  cpaInstanceId: number,
  fileName: string,
  options: { proxyUrl?: string | null; rawJson?: string | null; disabled?: boolean } = {},
) {
  const result = sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        status,
        status_message,
        disabled,
        available,
        proxy_url,
        raw_json
      )
      VALUES (
        @cpaInstanceId,
        @fileName,
        @email,
        'codex',
        '异常',
        'bad token',
        @disabled,
        0,
        @proxyUrl,
        @rawJson
      )
    `)
    .run({
      cpaInstanceId,
      fileName,
      email: fileName.replace(/^codex-/, "").replace(/-auto\.json$/, ""),
      disabled: options.disabled ? 1 : 0,
      proxyUrl: options.proxyUrl ?? null,
      rawJson: options.rawJson ?? null,
    });
  return Number(result.lastInsertRowid);
}

function insertProxy(
  sqlite: Database.Database,
  name: string,
  url: string,
  maxAuthFiles: number,
  enabled = true,
) {
  const result = sqlite
    .prepare(`
      INSERT INTO proxies (name, url, max_auth_files, enabled)
      VALUES (@name, @url, @maxAuthFiles, @enabled)
    `)
    .run({ name, url, maxAuthFiles, enabled: enabled ? 1 : 0 });
  return Number(result.lastInsertRowid);
}

function linkProxyToCpa(sqlite: Database.Database, proxyId: number, cpaInstanceId: number) {
  sqlite
    .prepare(`
      INSERT INTO proxy_cpa_instances (proxy_id, cpa_instance_id)
      VALUES (@proxyId, @cpaInstanceId)
    `)
    .run({ proxyId, cpaInstanceId });
}

function insertQuotaSnapshot(
  sqlite: Database.Database,
  cpaInstanceId: number,
  authFileName: string,
  options: { rawJson?: string | null } = {},
) {
  sqlite
    .prepare(`
      INSERT INTO quota_snapshots (
        cpa_instance_id,
        auth_file_name,
        email,
        available,
        exception,
        raw_json
      )
      VALUES (
        @cpaInstanceId,
        @authFileName,
        @email,
        0,
        'bad token',
        @rawJson
      )
    `)
    .run({
      cpaInstanceId,
      authFileName,
      email: authFileName.replace(/^codex-/, "").replace(/-auto\.json$/, ""),
      rawJson: options.rawJson ?? null,
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
