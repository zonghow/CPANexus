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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS auth_files_instance_file_unique
      ON auth_files(cpa_instance_id, file_name);

    CREATE TABLE IF NOT EXISTS exception_auth_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_cpa_instance_id INTEGER,
      source_cpa_instance_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      email TEXT,
      last_error TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS exception_auth_files_file_unique
      ON exception_auth_files(file_name);

    CREATE TABLE IF NOT EXISTS candidate_auth_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      email TEXT,
      provider TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      status TEXT,
      status_message TEXT,
      raw_json TEXT NOT NULL,
      quota_raw_json TEXT,
      usage_5h_percent REAL,
      usage_week_percent REAL,
      last_quota_refreshed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS candidate_auth_files_file_unique
      ON candidate_auth_files(file_name);
    CREATE INDEX IF NOT EXISTS candidate_auth_files_email_idx
      ON candidate_auth_files(email);
    CREATE INDEX IF NOT EXISTS candidate_auth_files_updated_at_idx
      ON candidate_auth_files(updated_at);

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
  if (!hasColumn(sqlite, "auth_files", "created_at")) {
    sqlite.exec(`
      ALTER TABLE auth_files ADD COLUMN created_at TEXT;
      UPDATE auth_files
        SET created_at = COALESCE(last_synced_at, CURRENT_TIMESTAMP)
        WHERE created_at IS NULL OR TRIM(created_at) = '';
    `);
  }

  sqlite.exec(`
    UPDATE auth_files
      SET created_at = COALESCE(last_synced_at, CURRENT_TIMESTAMP)
      WHERE created_at IS NULL OR TRIM(created_at) = '';
    UPDATE auth_files
      SET created_at = COALESCE(
        json_extract(raw_json, '$.created_at'),
        json_extract(raw_json, '$.createdAt'),
        json_extract(raw_json, '$.creation_time'),
        json_extract(raw_json, '$.creationTime'),
        json_extract(raw_json, '$.added_at'),
        json_extract(raw_json, '$.addedAt'),
        json_extract(raw_json, '$.add_time'),
        json_extract(raw_json, '$.addTime'),
        json_extract(raw_json, '$.uploaded_at'),
        json_extract(raw_json, '$.uploadedAt'),
        json_extract(raw_json, '$.upload_time'),
        json_extract(raw_json, '$.uploadTime'),
        json_extract(raw_json, '$.created'),
        json_extract(raw_json, '$.added'),
        json_extract(raw_json, '$.uploaded')
      )
      WHERE raw_json IS NOT NULL
        AND json_valid(raw_json)
        AND COALESCE(
          json_extract(raw_json, '$.created_at'),
          json_extract(raw_json, '$.createdAt'),
          json_extract(raw_json, '$.creation_time'),
          json_extract(raw_json, '$.creationTime'),
          json_extract(raw_json, '$.added_at'),
          json_extract(raw_json, '$.addedAt'),
          json_extract(raw_json, '$.add_time'),
          json_extract(raw_json, '$.addTime'),
          json_extract(raw_json, '$.uploaded_at'),
          json_extract(raw_json, '$.uploadedAt'),
          json_extract(raw_json, '$.upload_time'),
          json_extract(raw_json, '$.uploadTime'),
          json_extract(raw_json, '$.created'),
          json_extract(raw_json, '$.added'),
          json_extract(raw_json, '$.uploaded')
        ) IS NOT NULL
        AND TRIM(COALESCE(
          json_extract(raw_json, '$.created_at'),
          json_extract(raw_json, '$.createdAt'),
          json_extract(raw_json, '$.creation_time'),
          json_extract(raw_json, '$.creationTime'),
          json_extract(raw_json, '$.added_at'),
          json_extract(raw_json, '$.addedAt'),
          json_extract(raw_json, '$.add_time'),
          json_extract(raw_json, '$.addTime'),
          json_extract(raw_json, '$.uploaded_at'),
          json_extract(raw_json, '$.uploadedAt'),
          json_extract(raw_json, '$.upload_time'),
          json_extract(raw_json, '$.uploadTime'),
          json_extract(raw_json, '$.created'),
          json_extract(raw_json, '$.added'),
          json_extract(raw_json, '$.uploaded')
        )) != ''
        AND COALESCE(
          json_extract(raw_json, '$.created_at'),
          json_extract(raw_json, '$.createdAt'),
          json_extract(raw_json, '$.creation_time'),
          json_extract(raw_json, '$.creationTime'),
          json_extract(raw_json, '$.added_at'),
          json_extract(raw_json, '$.addedAt'),
          json_extract(raw_json, '$.add_time'),
          json_extract(raw_json, '$.addTime'),
          json_extract(raw_json, '$.uploaded_at'),
          json_extract(raw_json, '$.uploadedAt'),
          json_extract(raw_json, '$.upload_time'),
          json_extract(raw_json, '$.uploadTime'),
          json_extract(raw_json, '$.created'),
          json_extract(raw_json, '$.added'),
          json_extract(raw_json, '$.uploaded')
        ) < created_at;
    UPDATE proxies SET name = url WHERE name = '';
    UPDATE proxies SET max_auth_files = 10 WHERE max_auth_files IS NULL OR max_auth_files < 1;
    UPDATE auth_files
      SET proxy_url = json_extract(raw_json, '$.proxy_url')
      WHERE (proxy_url IS NULL OR TRIM(proxy_url) = '')
        AND raw_json IS NOT NULL
        AND json_valid(raw_json)
        AND json_type(raw_json, '$.proxy_url') = 'text'
        AND TRIM(json_extract(raw_json, '$.proxy_url')) != '';
    UPDATE candidate_auth_files
      SET status = NULL,
          status_message = NULL
      WHERE status = '已刷新RT'
        OR status_message IN ('Refresh Token 已轮换', 'Refresh Token 未轮换');
  `);

  sqlite.exec(`

    CREATE TABLE IF NOT EXISTS proxy_cpa_instances (
      proxy_id INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      PRIMARY KEY (proxy_id, cpa_instance_id)
    );

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
    CREATE UNIQUE INDEX IF NOT EXISTS job_runs_active_key_unique
      ON job_runs(job_key)
      WHERE finished_at IS NULL;

    CREATE TABLE IF NOT EXISTS cpa_instance_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'auth_files',
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      raw_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cpa_instance_sync_runs_active_instance_unique
      ON cpa_instance_sync_runs(cpa_instance_id)
      WHERE finished_at IS NULL;

    CREATE TABLE IF NOT EXISTS message_push_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      delivery_type TEXT NOT NULL DEFAULT 'webhook',
      trigger_type TEXT NOT NULL,
      threshold_percent REAL,
      scope_type TEXT NOT NULL DEFAULT 'all_enabled',
      webhook_url TEXT NOT NULL,
      headers_json TEXT NOT NULL DEFAULT '{}',
      body_template TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_push_policy_cpa_instances (
      policy_id INTEGER NOT NULL REFERENCES message_push_policies(id) ON DELETE CASCADE,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      PRIMARY KEY (policy_id, cpa_instance_id)
    );
    CREATE INDEX IF NOT EXISTS message_push_policy_cpa_instances_cpa_idx
      ON message_push_policy_cpa_instances(cpa_instance_id);

    CREATE TABLE IF NOT EXISTS message_push_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id INTEGER NOT NULL REFERENCES message_push_policies(id) ON DELETE CASCADE,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      trigger_key TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      activated_at TEXT,
      recovered_at TEXT,
      last_sent_at TEXT,
      last_value REAL,
      last_message TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS message_push_states_unique
      ON message_push_states(policy_id, cpa_instance_id, trigger_key);

    CREATE TABLE IF NOT EXISTS message_push_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id INTEGER NOT NULL REFERENCES message_push_policies(id) ON DELETE CASCADE,
      cpa_instance_id INTEGER NOT NULL REFERENCES cpa_instances(id) ON DELETE CASCADE,
      delivery_type TEXT NOT NULL DEFAULT 'webhook',
      trigger_key TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      error TEXT,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS message_push_deliveries_policy_time_idx
      ON message_push_deliveries(policy_id, sent_at);

  `);

  if (!hasColumn(sqlite, "cpa_instance_sync_runs", "phase")) {
    sqlite.exec("ALTER TABLE cpa_instance_sync_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'auth_files'");
  }

  if (!hasColumn(sqlite, "message_push_policies", "delivery_type")) {
    sqlite.exec("ALTER TABLE message_push_policies ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'webhook'");
  }

  if (!hasColumn(sqlite, "message_push_deliveries", "delivery_type")) {
    sqlite.exec("ALTER TABLE message_push_deliveries ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'webhook'");
  }

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
