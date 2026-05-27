import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string;

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

describe("migrate", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-migrate-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    process.env.DATABASE_URL = originalDatabaseUrl;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("backfills proxy_url from downloaded auth raw_json", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();
    const proxyUrl = "socks5://proxy-user:proxy-pass@127.0.0.1:1080/";
    const cpaInstanceId = sqlite
      .prepare(`
        INSERT INTO cpa_instances (name, base_url, password)
        VALUES ('target', 'https://target.example.com', 'secret')
      `)
      .run().lastInsertRowid;

    sqlite
      .prepare(`
        INSERT INTO auth_files (cpa_instance_id, file_name, email, proxy_url, raw_json)
        VALUES (?, 'target.json', 'target@example.com', NULL, ?)
      `)
      .run(cpaInstanceId, JSON.stringify({ email: "target@example.com", proxy_url: proxyUrl }));

    migrate();

    expect(
      sqlite.prepare("SELECT proxy_url FROM auth_files WHERE file_name = 'target.json'").get(),
    ).toEqual({ proxy_url: proxyUrl });
  });

  it("backfills auth file created_at from last_synced_at for existing databases", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    const sqlite = getSqlite();
    sqlite.exec(`
      CREATE TABLE cpa_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        password TEXT NOT NULL,
        quota_refresh_path TEXT NOT NULL DEFAULT '/v0/management/auth-files',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT,
        last_sync_status TEXT,
        last_sync_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE auth_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
        remote_id TEXT,
        auth_index TEXT,
        file_name TEXT NOT NULL,
        email TEXT,
        provider TEXT,
        label TEXT,
        status TEXT,
        status_message TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL DEFAULT 1,
        proxy_url TEXT,
        size INTEGER,
        raw_json TEXT,
        last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const cpaInstanceId = sqlite
      .prepare(`
        INSERT INTO cpa_instances (name, base_url, password)
        VALUES ('target', 'https://target.example.com', 'secret')
      `)
      .run().lastInsertRowid;
    sqlite
      .prepare(`
        INSERT INTO auth_files (cpa_instance_id, file_name, email, last_synced_at)
        VALUES (?, 'target.json', 'target@example.com', '2026-05-20T08:30:00.000Z')
      `)
      .run(cpaInstanceId);

    migrate();

    const columns = sqlite
      .prepare("PRAGMA table_info(auth_files)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("created_at");
    expect(
      sqlite.prepare("SELECT created_at FROM auth_files WHERE file_name = 'target.json'").get(),
    ).toEqual({ created_at: "2026-05-20T08:30:00.000Z" });
  });

  it("backfills auth file created_at from raw auth json when available", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();
    const cpaInstanceId = sqlite
      .prepare(`
        INSERT INTO cpa_instances (name, base_url, password)
        VALUES ('target', 'https://target.example.com', 'secret')
      `)
      .run().lastInsertRowid;
    sqlite
      .prepare(`
        INSERT INTO auth_files (cpa_instance_id, file_name, email, raw_json, created_at, last_synced_at)
        VALUES (?, 'target.json', 'target@example.com', ?, '2026-05-24T01:38:00.000Z', '2026-05-24T01:38:00.000Z')
      `)
      .run(
        cpaInstanceId,
        JSON.stringify({
          email: "target@example.com",
          added_at: "2026-05-20T08:30:00.000Z",
        }),
      );

    migrate();

    expect(
      sqlite.prepare("SELECT created_at FROM auth_files WHERE file_name = 'target.json'").get(),
    ).toEqual({ created_at: "2026-05-20T08:30:00.000Z" });
  });

  it("creates dashboard metric snapshot storage", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(dashboard_metric_snapshots)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "cpa_instance_id",
      "account_count",
      "available_account_count",
      "average_5h_remaining_percent",
      "average_week_remaining_percent",
      "proxy_count",
      "captured_at",
    ]);

    const indexes = sqlite
      .prepare("PRAGMA index_list(dashboard_metric_snapshots)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "dashboard_metric_snapshots_cpa_time_idx",
        "dashboard_metric_snapshots_time_idx",
      ]),
    );
  });

  it("adds sync phase storage for active CPA sync runs", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(cpa_instance_sync_runs)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("phase");
  });

  it("adds sync phase storage to existing CPA sync run tables", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    const sqlite = getSqlite();
    sqlite.exec(`
      CREATE TABLE cpa_instance_sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cpa_instance_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        raw_json TEXT
      );
    `);

    migrate();

    const columns = sqlite
      .prepare("PRAGMA table_info(cpa_instance_sync_runs)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("phase");
  });

  it("creates message push policy storage", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "message_push_policies",
        "message_push_policy_cpa_instances",
        "message_push_states",
        "message_push_deliveries",
      ]),
    );

    const policyColumns = sqlite
      .prepare("PRAGMA table_info(message_push_policies)")
      .all() as Array<{ name: string }>;
    expect(policyColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "delivery_type",
        "trigger_type",
        "threshold_percent",
        "scope_type",
        "webhook_url",
        "headers_json",
        "body_template",
        "enabled",
        "created_at",
        "updated_at",
      ]),
    );

    const stateIndexes = sqlite
      .prepare("PRAGMA index_list(message_push_states)")
      .all() as Array<{ name: string }>;
    expect(stateIndexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["message_push_states_unique"]),
    );

    const deliveryColumns = sqlite
      .prepare("PRAGMA table_info(message_push_deliveries)")
      .all() as Array<{ name: string }>;
    expect(deliveryColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["delivery_type"]),
    );
  });

  it("creates exception auth file storage", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(exception_auth_files)")
      .all() as Array<{ name: string; notnull: number }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "source_cpa_instance_id",
      "source_cpa_instance_name",
      "file_name",
      "email",
      "last_error",
      "raw_json",
      "created_at",
      "updated_at",
    ]);
    expect(columns.find((column) => column.name === "raw_json")?.notnull).toBe(1);

    const indexes = sqlite
      .prepare("PRAGMA index_list(exception_auth_files)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["exception_auth_files_file_unique"]),
    );
  });

  it("creates candidate auth file storage", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(candidate_auth_files)")
      .all() as Array<{ name: string; notnull: number }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "file_name",
      "email",
      "provider",
      "available",
      "status",
      "status_message",
      "raw_json",
      "quota_raw_json",
      "usage_5h_percent",
      "usage_week_percent",
      "last_quota_refreshed_at",
      "created_at",
      "updated_at",
    ]);
    expect(columns.find((column) => column.name === "raw_json")?.notnull).toBe(1);

    const indexes = sqlite
      .prepare("PRAGMA index_list(candidate_auth_files)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "candidate_auth_files_file_unique",
        "candidate_auth_files_email_idx",
        "candidate_auth_files_updated_at_idx",
      ]),
    );
  });

  it("cleans candidate RT refresh success status from existing databases", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();
    sqlite
      .prepare(`
        INSERT INTO candidate_auth_files (
          file_name,
          email,
          status,
          status_message,
          raw_json
        )
        VALUES
          (
            'success.json',
            'success@example.com',
            '已刷新RT',
            'Refresh Token 已轮换',
            '{"type":"codex","email":"success@example.com"}'
          ),
          (
            'failed.json',
            'failed@example.com',
            '刷新RT失败',
            'OpenAI token refresh failed',
            '{"type":"codex","email":"failed@example.com"}'
          )
      `)
      .run();

    migrate();

    expect(
      sqlite
        .prepare("SELECT status, status_message FROM candidate_auth_files WHERE file_name = 'success.json'")
        .get(),
    ).toEqual({ status: null, status_message: null });
    expect(
      sqlite
        .prepare("SELECT status, status_message FROM candidate_auth_files WHERE file_name = 'failed.json'")
        .get(),
    ).toEqual({
      status: "刷新RT失败",
      status_message: "OpenAI token refresh failed",
    });
  });
});
