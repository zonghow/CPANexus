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
});
