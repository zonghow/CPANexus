import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  patchRemoteAuthFileFields: vi.fn(),
  uploadRemoteAuthFile: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;
let importedAtCounter = 0;

describe("/api/cpa-instances/[id]/replenish", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-replenish-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    importedAtCounter = 0;
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

  it("quickly uploads the requested number of idle backup accounts", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const first = insertBackupAccount(sqlite, "first@example.com", "rt_first");
    const second = insertBackupAccount(sqlite, "second@example.com", "rt_second");
    insertBackupAccount(sqlite, "assigned@example.com", "rt_assigned", { assignedCpaInstanceId: cpaInstanceId });
    insertBackupAccount(sqlite, "error@example.com", "rt_error", { exception: "bad token" });

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/replenish", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ count: 2 }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ uploaded: 2 });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledTimes(2);
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-first@example.com-auto.json",
      expect.objectContaining({ email: "first@example.com", refresh_token: "rt_first" }),
    );
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-second@example.com-auto.json",
      expect.objectContaining({ email: "second@example.com", refresh_token: "rt_second" }),
    );
    expectBackupAssigned(sqlite, first, cpaInstanceId, "codex-first@example.com-auto.json");
    expectBackupAssigned(sqlite, second, cpaInstanceId, "codex-second@example.com-auto.json");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 2 });
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "quick",
        status: "success",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: first,
        email: "first@example.com",
        auth_file_name: "codex-first@example.com-auto.json",
        reason_codes: null,
        error: null,
      },
      {
        source: "quick",
        status: "success",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: second,
        email: "second@example.com",
        auth_file_name: "codex-second@example.com-auto.json",
        reason_codes: null,
        error: null,
      },
    ]);
  });

  it("uploads only manually selected idle backup accounts", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const selected = insertBackupAccount(sqlite, "selected@example.com", "rt_selected");
    insertBackupAccount(sqlite, "idle@example.com", "rt_idle");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/replenish", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ backupAccountIds: [selected] }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ uploaded: 1 });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledTimes(1);
    expectBackupAssigned(sqlite, selected, cpaInstanceId, "codex-selected@example.com-auto.json");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 1 });
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "manual",
        status: "success",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: selected,
        email: "selected@example.com",
        auth_file_name: "codex-selected@example.com-auto.json",
        reason_codes: null,
        error: null,
      },
    ]);
  });

  it("rejects quick replenish when the backup pool has fewer accounts than requested", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertBackupAccount(sqlite, "only@example.com", "rt_only");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/replenish", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ count: 5 }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "替补号池可用数量不足：需要 5 个，当前可用 1 个",
    });
    expect(cpaClient.uploadRemoteAuthFile).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 0 });
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "quick",
        status: "error",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: null,
        email: null,
        auth_file_name: null,
        reason_codes: null,
        error: "替补号池可用数量不足：需要 5 个，当前可用 1 个",
      },
    ]);
  });

  it("rejects manual replenish when selected accounts are no longer available", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const assigned = insertBackupAccount(sqlite, "assigned@example.com", "rt_assigned", {
      assignedCpaInstanceId: cpaInstanceId,
    });

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/replenish", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ backupAccountIds: [assigned] }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "选择的替补账号不可用或已被归属",
    });
    expect(cpaClient.uploadRemoteAuthFile).not.toHaveBeenCalled();
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

function insertBackupAccount(
  sqlite: Database.Database,
  email: string,
  refreshToken: string,
  options: { assignedCpaInstanceId?: number; exception?: string } = {},
) {
  const result = sqlite
    .prepare(`
      INSERT INTO backup_accounts (
        source_line,
        email,
        refresh_token,
        status,
        assigned_cpa_instance_id,
        assigned_auth_file_name,
        exception,
        imported_at
      )
      VALUES (
        @sourceLine,
        @email,
        @refreshToken,
        @status,
        @assignedCpaInstanceId,
        @assignedAuthFileName,
        @exception,
        @importedAt
      )
    `)
    .run({
      sourceLine: `${email}----password----${refreshToken}`,
      email,
      refreshToken,
      status: options.assignedCpaInstanceId ? "assigned" : "idle",
      assignedCpaInstanceId: options.assignedCpaInstanceId ?? null,
      assignedAuthFileName: options.assignedCpaInstanceId ? `codex-${email}-auto.json` : null,
      exception: options.exception ?? null,
      importedAt: new Date(Date.UTC(2026, 4, 13, 0, 0, importedAtCounter++)).toISOString(),
    });
  return Number(result.lastInsertRowid);
}

function expectBackupAssigned(
  sqlite: Database.Database,
  id: number,
  cpaInstanceId: number,
  fileName: string,
) {
  expect(
    sqlite
      .prepare("SELECT status, assigned_cpa_instance_id, assigned_auth_file_name, exception FROM backup_accounts WHERE id = ?")
      .get(id),
  ).toMatchObject({
    status: "assigned",
    assigned_cpa_instance_id: cpaInstanceId,
    assigned_auth_file_name: fileName,
    exception: null,
  });
}

function expectReplenishmentRecords(sqlite: Database.Database) {
  return sqlite
    .prepare(`
      SELECT
        source,
        status,
        cpa_instance_id,
        cpa_instance_name,
        backup_account_id,
        email,
        auth_file_name,
        reason_codes,
        error
      FROM replenishment_records
      ORDER BY id
    `)
    .all();
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
