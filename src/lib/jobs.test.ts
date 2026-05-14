import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cpa-client", () => ({
  downloadRemoteAuthFile: vi.fn(),
  listRemoteAuthFiles: vi.fn(),
  patchRemoteAuthFileFields: vi.fn(),
  refreshRemoteQuotas: vi.fn(),
  uploadRemoteAuthFile: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("autoReplenish", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-jobs-"));
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

  it("records successful automatic replenishment uploads", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertStrategy(sqlite, cpaInstanceId);
    const backupAccountId = insertBackupAccount(sqlite, "auto@example.com", "rt_auto");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const jobs = await import("./jobs");

    const result = await jobs.autoReplenish();

    expect(result).toMatchObject({ status: "success" });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-auto@example.com-auto.json",
      expect.objectContaining({ email: "auto@example.com", refresh_token: "rt_auto" }),
    );
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "auto",
        status: "success",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: backupAccountId,
        email: "auto@example.com",
        auth_file_name: "codex-auto@example.com-auto.json",
        reason_codes: JSON.stringify(["available_accounts_below_target"]),
        error: null,
      },
    ]);
  });

  it("records failed automatic replenishment uploads", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertStrategy(sqlite, cpaInstanceId);
    const backupAccountId = insertBackupAccount(sqlite, "broken@example.com", "rt_broken");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockRejectedValue(new Error("upload denied"));
    const jobs = await import("./jobs");

    const result = await jobs.autoReplenish();

    expect(result).toMatchObject({
      status: "error",
      message: "自动补号完成：上传 0 个，失败实例 1 个",
    });
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "auto",
        status: "error",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: backupAccountId,
        email: "broken@example.com",
        auth_file_name: "codex-broken@example.com-auto.json",
        reason_codes: JSON.stringify(["available_accounts_below_target"]),
        error: "upload denied",
      },
    ]);
  });

  it("runs automatic replenishment as part of the CPA sync job", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    insertStrategy(sqlite, cpaInstanceId);
    const backupAccountId = insertBackupAccount(sqlite, "sync-auto@example.com", "rt_sync_auto");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([]);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const jobs = await import("./jobs");

    const result = await jobs.runJobByKey("sync-cpa-instances");

    expect(result.status).toBe("success");
    expect(result.message).toContain("同步完成：1 成功，0 失败");
    expect(result.message).toContain("自动补号完成：上传 1 个，失败实例 0 个");
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-sync-auto@example.com-auto.json",
      expect.objectContaining({ email: "sync-auto@example.com", refresh_token: "rt_sync_auto" }),
    );
    expect(expectReplenishmentRecords(sqlite)).toEqual([
      {
        source: "auto",
        status: "success",
        cpa_instance_id: cpaInstanceId,
        cpa_instance_name: "target",
        backup_account_id: backupAccountId,
        email: "sync-auto@example.com",
        auth_file_name: "codex-sync-auto@example.com-auto.json",
        reason_codes: JSON.stringify(["available_accounts_below_target"]),
        error: null,
      },
    ]);
    expect(
      sqlite.prepare("SELECT job_key, status FROM job_runs ORDER BY id").all(),
    ).toEqual([{ job_key: "sync-cpa-instances", status: "success" }]);
  });

  it("reads per-account proxy_url from downloaded auth files during sync", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const proxyUrl = "socks5://proxy-user:proxy-pass@127.0.0.1:1080/";

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([
      {
        name: "proxy-user@example.com.json",
        email: "proxy-user@example.com",
        type: "codex",
      },
    ]);
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockResolvedValue({
      type: "codex",
      email: "proxy-user@example.com",
      refresh_token: "rt_test",
      proxy_url: proxyUrl,
    });
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    const result = await jobs.syncCpaInstances();

    expect(result).toMatchObject({ status: "success" });
    expect(
      sqlite
        .prepare("SELECT proxy_url FROM auth_files WHERE cpa_instance_id = ? AND email = ?")
        .get(cpaInstanceId, "proxy-user@example.com"),
    ).toEqual({ proxy_url: proxyUrl });
  });
});

describe("refreshAuthFileQuotaById", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-refresh-auth-quota-"));
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

  it("refreshes quota for one auth file without replacing other account snapshots", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const authFileId = insertAuthFile(sqlite, cpaInstanceId, {
      fileName: "codex-target@example.com-auto.json",
      email: "target@example.com",
      authIndex: "auth-target",
      rawJson: JSON.stringify({
        id_token: { chatgpt_account_id: "acct-target" },
      }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "codex-target@example.com-auto.json",
      email: "target@example.com",
      usage5hPercent: 90,
      usageWeekPercent: 91,
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "codex-other@example.com-auto.json",
      email: "other@example.com",
      usage5hPercent: 12,
      usageWeekPercent: 34,
    });
    insertAssignedBackupAccount(sqlite, cpaInstanceId, "target@example.com", "codex-target@example.com-auto.json");

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([
      {
        authFileName: "codex-target@example.com-auto.json",
        email: "target@example.com",
        usage5hPercent: 23,
        usageWeekPercent: 45,
        available: true,
        exception: null,
        raw: { refreshed: true },
      },
    ]);
    const jobs = await import("./jobs");

    const result = await jobs.refreshAuthFileQuotaById(authFileId);

    expect(result).toMatchObject({
      instance: "target",
      status: "success",
      message: "refreshed 1 quota snapshot",
    });
    expect(cpaClient.refreshRemoteQuotas).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      [
        expect.objectContaining({
          name: "codex-target@example.com-auto.json",
          email: "target@example.com",
          auth_index: "auth-target",
          id_token: { chatgpt_account_id: "acct-target" },
        }),
      ],
    );
    expect(
      sqlite
        .prepare(`
          SELECT auth_file_name, email, usage_5h_percent, usage_week_percent
          FROM quota_snapshots
          ORDER BY auth_file_name
        `)
        .all(),
    ).toEqual([
      {
        auth_file_name: "codex-other@example.com-auto.json",
        email: "other@example.com",
        usage_5h_percent: 12,
        usage_week_percent: 34,
      },
      {
        auth_file_name: "codex-target@example.com-auto.json",
        email: "target@example.com",
        usage_5h_percent: 23,
        usage_week_percent: 45,
      },
    ]);
    expect(
      sqlite
        .prepare("SELECT available, status, status_message FROM auth_files WHERE id = ?")
        .get(authFileId),
    ).toMatchObject({
      available: 1,
      status: "可用",
      status_message: null,
    });
    expect(
      sqlite
        .prepare("SELECT status, exception FROM backup_accounts WHERE email = 'target@example.com'")
        .get(),
    ).toMatchObject({
      status: "assigned",
      exception: null,
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

function insertStrategy(sqlite: Database.Database, cpaInstanceId: number) {
  sqlite
    .prepare(`
      INSERT INTO replenishment_strategies (
        cpa_instance_id,
        enabled,
        maintain_5h_usage_percent,
        maintain_week_usage_percent,
        min_available_accounts,
        max_batch_size
      )
      VALUES (?, 1, 0, 0, 1, 1)
    `)
    .run(cpaInstanceId);
}

function insertBackupAccount(sqlite: Database.Database, email: string, refreshToken: string) {
  const result = sqlite
    .prepare(`
      INSERT INTO backup_accounts (source_line, email, refresh_token, status, imported_at)
      VALUES (@sourceLine, @email, @refreshToken, 'idle', @importedAt)
    `)
    .run({
      sourceLine: `${email}----password----${refreshToken}`,
      email,
      refreshToken,
      importedAt: new Date(Date.UTC(2026, 4, 13, 0, 0, 0)).toISOString(),
    });
  return Number(result.lastInsertRowid);
}

function insertAuthFile(
  sqlite: Database.Database,
  cpaInstanceId: number,
  input: {
    fileName: string;
    email: string;
    authIndex: string;
    rawJson: string;
  },
) {
  const result = sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        auth_index,
        status,
        available,
        raw_json
      )
      VALUES (
        @cpaInstanceId,
        @fileName,
        @email,
        'codex',
        @authIndex,
        '待配额刷新',
        0,
        @rawJson
      )
    `)
    .run({ cpaInstanceId, ...input });
  return Number(result.lastInsertRowid);
}

function insertQuotaSnapshot(
  sqlite: Database.Database,
  cpaInstanceId: number,
  input: {
    authFileName: string;
    email: string;
    usage5hPercent: number;
    usageWeekPercent: number;
  },
) {
  sqlite
    .prepare(`
      INSERT INTO quota_snapshots (
        cpa_instance_id,
        auth_file_name,
        email,
        usage_5h_percent,
        usage_week_percent,
        available,
        captured_at
      )
      VALUES (
        @cpaInstanceId,
        @authFileName,
        @email,
        @usage5hPercent,
        @usageWeekPercent,
        1,
        '2026-05-13T00:00:00.000Z'
      )
    `)
    .run({ cpaInstanceId, ...input });
}

function insertAssignedBackupAccount(
  sqlite: Database.Database,
  cpaInstanceId: number,
  email: string,
  authFileName: string,
) {
  sqlite
    .prepare(`
      INSERT INTO backup_accounts (
        source_line,
        email,
        refresh_token,
        status,
        assigned_cpa_instance_id,
        assigned_auth_file_name,
        exception
      )
      VALUES (
        @sourceLine,
        @email,
        'rt_test',
        'error',
        @cpaInstanceId,
        @authFileName,
        'old error'
      )
    `)
    .run({
      sourceLine: `${email}----password----rt_test`,
      email,
      cpaInstanceId,
      authFileName,
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
