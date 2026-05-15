import { getSqlite } from "./client";

export function migrate() {
  const sqlite = getSqlite();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cpa_instances (
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

    CREATE TABLE IF NOT EXISTS auth_files (
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
    CREATE UNIQUE INDEX IF NOT EXISTS auth_files_instance_file_unique
      ON auth_files(cpa_instance_id, file_name);

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      auth_file_name TEXT,
      email TEXT,
      usage_5h_percent REAL,
      usage_week_percent REAL,
      available INTEGER NOT NULL DEFAULT 1,
      exception TEXT,
      raw_json TEXT,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dashboard_metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      account_count INTEGER NOT NULL DEFAULT 0,
      available_account_count INTEGER NOT NULL DEFAULT 0,
      average_5h_remaining_percent REAL,
      average_week_remaining_percent REAL,
      proxy_count INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS dashboard_metric_snapshots_cpa_time_idx
      ON dashboard_metric_snapshots(cpa_instance_id, captured_at);
    CREATE INDEX IF NOT EXISTS dashboard_metric_snapshots_time_idx
      ON dashboard_metric_snapshots(captured_at);

    CREATE TABLE IF NOT EXISTS replenishment_strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      maintain_5h_usage_percent REAL NOT NULL DEFAULT 50,
      maintain_week_usage_percent REAL NOT NULL DEFAULT 50,
      min_available_accounts INTEGER NOT NULL DEFAULT 1,
      max_batch_size INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS replenishment_strategies_instance_unique
      ON replenishment_strategies(cpa_instance_id);

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      max_auth_files INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!hasColumn(sqlite, "proxies", "name")) {
    sqlite.exec("ALTER TABLE proxies ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }

  sqlite.exec(`
    UPDATE proxies SET name = url WHERE name = '';
    UPDATE proxies SET max_auth_files = 10 WHERE max_auth_files IS NULL OR max_auth_files < 1;
    UPDATE auth_files
      SET proxy_url = json_extract(raw_json, '$.proxy_url')
      WHERE (proxy_url IS NULL OR TRIM(proxy_url) = '')
        AND raw_json IS NOT NULL
        AND json_valid(raw_json)
        AND json_type(raw_json, '$.proxy_url') = 'text'
        AND TRIM(json_extract(raw_json, '$.proxy_url')) != '';
  `);

  sqlite.exec(`

    CREATE TABLE IF NOT EXISTS proxy_cpa_instances (
      proxy_id INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      PRIMARY KEY (proxy_id, cpa_instance_id)
    );

    CREATE TABLE IF NOT EXISTS backup_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_line TEXT NOT NULL,
      email TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      assigned_cpa_instance_id INTEGER REFERENCES cpa_instances(id) ON DELETE SET NULL,
      assigned_auth_file_name TEXT,
      exception TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_at TEXT,
      last_checked_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS backup_accounts_email_unique
      ON backup_accounts(email);

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cron_jobs_key_unique ON cron_jobs(key);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_key TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS replenishment_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      cpa_instance_id INTEGER REFERENCES cpa_instances(id) ON DELETE SET NULL,
      cpa_instance_name TEXT,
      backup_account_id INTEGER REFERENCES backup_accounts(id) ON DELETE SET NULL,
      email TEXT,
      auth_file_name TEXT,
      reason_codes TEXT,
      error TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS replenishment_records_created_at_idx
      ON replenishment_records(created_at);
  `);

  const seed = sqlite.prepare(`
    INSERT OR IGNORE INTO cron_jobs (key, name, cron, enabled)
    VALUES (@key, @name, @cron, @enabled)
  `);

  seed.run({
    key: "sync-cpa-instances",
    name: "同步 CPA 实例认证文件和配额",
    cron: "*/10 * * * *",
    enabled: 1,
  });
  sqlite.prepare("DELETE FROM cron_jobs WHERE key = 'auto-replenish'").run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  console.log("CPA Nexus database initialized");
}

function hasColumn(
  sqlite: ReturnType<typeof getSqlite>,
  tableName: string,
  columnName: string,
) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}
