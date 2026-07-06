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

describe("sync jobs", () => {
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

  it("runs only the CPA sync job", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([]);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    const result = await jobs.runJobByKey("sync-cpa-instances");

    expect(result).toMatchObject({
      status: "success",
      message: "同步完成：1 成功，0 失败",
    });
    expect(cpaClient.uploadRemoteAuthFile).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT job_key, status FROM job_runs ORDER BY id").all(),
    ).toEqual([{ job_key: "sync-cpa-instances", status: "success" }]);
  });

  it("rejects overlapping sync jobs while one is still running", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    const remoteFiles = deferred<never[]>();
    vi.mocked(cpaClient.listRemoteAuthFiles).mockReturnValue(remoteFiles.promise);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    const firstRun = jobs.runJobByKey("sync-cpa-instances");
    await vi.waitFor(() => {
      expect(
        sqlite
          .prepare("SELECT status FROM job_runs WHERE job_key = 'sync-cpa-instances' AND finished_at IS NULL")
          .get(),
      ).toEqual({ status: "running" });
    });

    await expect(jobs.runJobByKey("sync-cpa-instances")).rejects.toThrow(
      "当前有同步任务正在进行中",
    );

    remoteFiles.resolve([]);
    await expect(firstRun).resolves.toMatchObject({ status: "success" });
    expect(
      sqlite.prepare("SELECT job_key, status, finished_at IS NOT NULL AS finished FROM job_runs ORDER BY id").all(),
    ).toEqual([{ job_key: "sync-cpa-instances", status: "success", finished: 1 }]);
  });

  it("prevents overlapping syncs for the same CPA instance", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    const remoteFiles = deferred<never[]>();
    vi.mocked(cpaClient.listRemoteAuthFiles).mockReturnValue(remoteFiles.promise);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    const firstRun = jobs.syncCpaInstanceById(cpaInstanceId);
    await vi.waitFor(() => {
      expect(
        sqlite
          .prepare("SELECT status, phase FROM cpa_instance_sync_runs WHERE cpa_instance_id = ? AND finished_at IS NULL")
          .get(cpaInstanceId),
      ).toEqual({ status: "running", phase: "auth_files" });
    });

    await expect(jobs.syncCpaInstanceById(cpaInstanceId)).rejects.toThrow(
      "CPA target 正在同步中",
    );

    const globalRun = await jobs.runJobByKey("sync-cpa-instances");
    expect(globalRun).toMatchObject({
      status: "error",
      message: "同步完成：0 成功，1 失败",
      details: [
        {
          instance: "target",
          status: "error",
          message: "CPA target 正在同步中，已跳过",
        },
      ],
    });

    remoteFiles.resolve([]);
    await expect(firstRun).resolves.toMatchObject({ status: "success" });
    expect(
      sqlite
        .prepare(`
          SELECT cpa_instance_id, status, finished_at IS NOT NULL AS finished
          FROM cpa_instance_sync_runs
          ORDER BY id
        `)
        .all(),
    ).toEqual([
      { cpa_instance_id: cpaInstanceId, status: "success", finished: 1 },
    ]);
  });

  it("marks a CPA sync as quota phase after auth files are synced", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    const quotaRefresh = deferred<never[]>();
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([]);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockReturnValue(quotaRefresh.promise);
    const jobs = await import("./jobs");

    const run = jobs.syncCpaInstanceById(cpaInstanceId);
    await vi.waitFor(() => {
      expect(
        sqlite
          .prepare(`
            SELECT status, phase, message
            FROM cpa_instance_sync_runs
            WHERE cpa_instance_id = ?
              AND finished_at IS NULL
          `)
          .get(cpaInstanceId),
      ).toEqual({
        status: "running",
        phase: "quotas",
        message: "刷新配额中",
      });
    });

    quotaRefresh.resolve([]);
    await expect(run).resolves.toMatchObject({ status: "success" });
  });

  it("writes listed auth files before full payload downloads finish", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    const authPayload = deferred<unknown>();
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([
      {
        name: "fast@example.com.json",
        email: "fast@example.com",
        type: "codex",
      },
    ]);
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockReturnValue(authPayload.promise);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    const run = jobs.syncCpaInstanceById(cpaInstanceId);
    await vi.waitFor(() => {
      expect(
        sqlite
          .prepare(`
            SELECT status, phase
            FROM cpa_instance_sync_runs
            WHERE cpa_instance_id = ?
              AND finished_at IS NULL
          `)
          .get(cpaInstanceId),
      ).toEqual({
        status: "running",
        phase: "auth_payloads",
      });
      expect(
        sqlite
          .prepare(`
            SELECT email, json_extract(raw_json, '$.name') AS raw_name
            FROM auth_files
            WHERE cpa_instance_id = ?
          `)
          .get(cpaInstanceId),
      ).toEqual({
        email: "fast@example.com",
        raw_name: "fast@example.com.json",
      });
    });
    expect(cpaClient.refreshRemoteQuotas).not.toHaveBeenCalled();

    authPayload.resolve({
      type: "codex",
      email: "fast@example.com",
      refresh_token: "rt_full",
    });
    await expect(run).resolves.toMatchObject({ status: "success" });
    expect(
      sqlite
        .prepare("SELECT json_extract(raw_json, '$.refresh_token') AS refresh_token FROM auth_files WHERE cpa_instance_id = ?")
        .get(cpaInstanceId),
    ).toEqual({ refresh_token: "rt_full" });
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

  it("records each remote auth file creation time and preserves it across later syncs", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles)
      .mockResolvedValueOnce([
        {
          name: "first@example.com.json",
          email: "first@example.com",
          type: "codex",
          created_at: "2026-05-20T08:30:00.000Z",
        },
        {
          name: "second@example.com.json",
          email: "second@example.com",
          type: "codex",
          uploaded_at: "2026-05-21T09:45:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          name: "first@example.com.json",
          email: "first@example.com",
          type: "codex",
          created_at: "2026-05-24T01:38:00.000Z",
        },
        {
          name: "second@example.com.json",
          email: "second@example.com",
          type: "codex",
          uploaded_at: "2026-05-24T01:38:00.000Z",
        },
      ]);
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockRejectedValue(new Error("download skipped"));
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    await jobs.syncCpaInstances();
    await jobs.syncCpaInstances();

    expect(
      sqlite
        .prepare(`
          SELECT file_name, created_at
          FROM auth_files
          WHERE cpa_instance_id = ?
          ORDER BY file_name
        `)
        .all(cpaInstanceId),
    ).toEqual([
      {
        file_name: "first@example.com.json",
        created_at: "2026-05-20T08:30:00.000Z",
      },
      {
        file_name: "second@example.com.json",
        created_at: "2026-05-21T09:45:00.000Z",
      },
    ]);
  });

  it("uses downloaded auth payload creation time when the list item does not include it", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([
      { name: "downloaded@example.com.json", email: "downloaded@example.com", type: "codex" },
    ]);
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockResolvedValue({
      type: "codex",
      email: "downloaded@example.com",
      added_at: "2026-05-22T10:15:00.000Z",
    });
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([]);
    const jobs = await import("./jobs");

    await jobs.syncCpaInstances();

    expect(
      sqlite
        .prepare("SELECT created_at FROM auth_files WHERE cpa_instance_id = ? AND file_name = ?")
        .get(cpaInstanceId, "downloaded@example.com.json"),
    ).toEqual({ created_at: "2026-05-22T10:15:00.000Z" });
  });

  it("records a dashboard metric snapshot after syncing quotas", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    sqlite
      .prepare(`
        INSERT INTO proxies (id, name, url, enabled)
        VALUES (1, 'proxy-a', 'http://proxy-a.example.com', 1)
      `)
      .run();
    sqlite
      .prepare(`
        INSERT INTO proxy_cpa_instances (proxy_id, cpa_instance_id)
        VALUES (1, ?)
      `)
      .run(cpaInstanceId);

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([
      { name: "a.json", email: "a@example.com", type: "codex" },
      { name: "b.json", email: "b@example.com", type: "codex" },
    ]);
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockRejectedValue(new Error("download skipped"));
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([
      {
        authFileName: "a.json",
        email: "a@example.com",
        usage5hPercent: 20,
        usageWeekPercent: 40,
        available: true,
        exception: null,
        raw: { email: "a@example.com" },
      },
      {
        authFileName: "b.json",
        email: "b@example.com",
        usage5hPercent: 60,
        usageWeekPercent: 80,
        available: false,
        exception: "refresh failed",
        raw: { email: "b@example.com" },
      },
    ]);
    const jobs = await import("./jobs");

    const result = await jobs.syncCpaInstances();

    expect(result).toMatchObject({ status: "success" });
    expect(
      sqlite
        .prepare(`
          SELECT
            cpa_instance_id,
            account_count,
            available_account_count,
            average_5h_remaining_percent,
            average_week_remaining_percent,
            proxy_count
          FROM dashboard_metric_snapshots
        `)
        .all(),
    ).toEqual([
      {
        cpa_instance_id: cpaInstanceId,
        account_count: 2,
        available_account_count: 1,
        average_5h_remaining_percent: 60,
        average_week_remaining_percent: 40,
        proxy_count: 1,
      },
    ]);
  });

  it("keeps same-email auth files separate when applying quota status", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.listRemoteAuthFiles).mockResolvedValue([
      { name: "shared-primary.json", email: "shared@example.com", type: "codex" },
      { name: "shared-secondary.json", email: "shared@example.com", type: "codex" },
    ]);
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([
      {
        authFileName: "shared-primary.json",
        email: "shared@example.com",
        usage5hPercent: 10,
        usageWeekPercent: 20,
        available: true,
        exception: null,
        raw: { name: "shared-primary.json" },
      },
      {
        authFileName: "shared-secondary.json",
        email: "shared@example.com",
        usage5hPercent: 80,
        usageWeekPercent: 90,
        available: false,
        exception: "refresh failed",
        raw: { name: "shared-secondary.json" },
      },
    ]);
    const jobs = await import("./jobs");

    const result = await jobs.syncCpaInstances();

    expect(result).toMatchObject({ status: "success" });
    expect(
      sqlite
        .prepare(`
          SELECT file_name, email, available, status, status_message
          FROM auth_files
          WHERE cpa_instance_id = ?
          ORDER BY file_name
        `)
        .all(cpaInstanceId),
    ).toEqual([
      {
        file_name: "shared-primary.json",
        email: "shared@example.com",
        available: 1,
        status: "可用",
        status_message: null,
      },
      {
        file_name: "shared-secondary.json",
        email: "shared@example.com",
        available: 0,
        status: "异常",
        status_message: "refresh failed",
      },
    ]);
    expect(
      sqlite
        .prepare(`
          SELECT auth_file_name, email, usage_5h_percent, usage_week_percent
          FROM quota_snapshots
          WHERE cpa_instance_id = ?
          ORDER BY auth_file_name
        `)
        .all(cpaInstanceId),
    ).toEqual([
      {
        auth_file_name: "shared-primary.json",
        email: "shared@example.com",
        usage_5h_percent: 10,
        usage_week_percent: 20,
      },
      {
        auth_file_name: "shared-secondary.json",
        email: "shared@example.com",
        usage_5h_percent: 80,
        usage_week_percent: 90,
      },
    ]);
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
  });

  it("does not replace another auth file snapshot with the same email", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const authFileId = insertAuthFile(sqlite, cpaInstanceId, {
      fileName: "shared-primary.json",
      email: "shared@example.com",
      authIndex: "auth-primary",
      rawJson: JSON.stringify({
        id_token: { chatgpt_account_id: "acct-primary" },
      }),
    });
    insertAuthFile(sqlite, cpaInstanceId, {
      fileName: "shared-secondary.json",
      email: "shared@example.com",
      authIndex: "auth-secondary",
      rawJson: JSON.stringify({
        id_token: { chatgpt_account_id: "acct-secondary" },
      }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "shared-primary.json",
      email: "shared@example.com",
      usage5hPercent: 10,
      usageWeekPercent: 20,
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, {
      authFileName: "shared-secondary.json",
      email: "shared@example.com",
      usage5hPercent: 80,
      usageWeekPercent: 90,
    });

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.refreshRemoteQuotas).mockResolvedValue([
      {
        authFileName: "shared-primary.json",
        email: "shared@example.com",
        usage5hPercent: 12,
        usageWeekPercent: 22,
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
        auth_file_name: "shared-primary.json",
        email: "shared@example.com",
        usage_5h_percent: 12,
        usage_week_percent: 22,
      },
      {
        auth_file_name: "shared-secondary.json",
        email: "shared@example.com",
        usage_5h_percent: 80,
        usage_week_percent: 90,
      },
    ]);
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
