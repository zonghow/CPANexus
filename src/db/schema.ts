import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const cpaInstances = sqliteTable("cpa_instances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  password: text("password").notNull(),
  quotaRefreshPath: text("quota_refresh_path").notNull().default("/v0/management/auth-files"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  lastSyncStatus: text("last_sync_status"),
  lastSyncError: text("last_sync_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authFiles = sqliteTable(
  "auth_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
    remoteId: text("remote_id"),
    authIndex: text("auth_index"),
    fileName: text("file_name").notNull(),
    email: text("email"),
    provider: text("provider"),
    label: text("label"),
    status: text("status"),
    statusMessage: text("status_message"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    proxyUrl: text("proxy_url"),
    size: integer("size"),
    rawJson: text("raw_json"),
    lastSyncedAt: text("last_synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_files_instance_file_unique").on(
      table.cpaInstanceId,
      table.fileName,
    ),
  ],
);

export const quotaSnapshots = sqliteTable("quota_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cpaInstanceId: integer("cpa_instance_id")
    .notNull()
    .references(() => cpaInstances.id, { onDelete: "cascade" }),
  authFileName: text("auth_file_name"),
  email: text("email"),
  usage5hPercent: real("usage_5h_percent"),
  usageWeekPercent: real("usage_week_percent"),
  available: integer("available", { mode: "boolean" }).notNull().default(true),
  exception: text("exception"),
  rawJson: text("raw_json"),
  capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dashboardMetricSnapshots = sqliteTable(
  "dashboard_metric_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
    accountCount: integer("account_count").notNull().default(0),
    availableAccountCount: integer("available_account_count").notNull().default(0),
    average5hRemainingPercent: real("average_5h_remaining_percent"),
    averageWeekRemainingPercent: real("average_week_remaining_percent"),
    proxyCount: integer("proxy_count").notNull().default(0),
    capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("dashboard_metric_snapshots_cpa_time_idx").on(
      table.cpaInstanceId,
      table.capturedAt,
    ),
    index("dashboard_metric_snapshots_time_idx").on(table.capturedAt),
  ],
);

export const replenishmentStrategies = sqliteTable(
  "replenishment_strategies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    maintain5hUsagePercent: real("maintain_5h_usage_percent").notNull().default(50),
    maintainWeekUsagePercent: real("maintain_week_usage_percent").notNull().default(50),
    minAvailableAccounts: integer("min_available_accounts").notNull().default(1),
    maxBatchSize: integer("max_batch_size").notNull().default(1),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("replenishment_strategies_instance_unique").on(
      table.cpaInstanceId,
    ),
  ],
);

export const proxies = sqliteTable("proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""),
  url: text("url").notNull(),
  maxAuthFiles: integer("max_auth_files").notNull().default(10),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const proxyCpaInstances = sqliteTable(
  "proxy_cpa_instances",
  {
    proxyId: integer("proxy_id")
      .notNull()
      .references(() => proxies.id, { onDelete: "cascade" }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.proxyId, table.cpaInstanceId] }),
  ],
);

export const backupAccounts = sqliteTable(
  "backup_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceLine: text("source_line").notNull(),
    email: text("email").notNull(),
    refreshToken: text("refresh_token").notNull(),
    status: text("status").notNull().default("idle"),
    assignedCpaInstanceId: integer("assigned_cpa_instance_id").references(
      () => cpaInstances.id,
      { onDelete: "set null" },
    ),
    assignedAuthFileName: text("assigned_auth_file_name"),
    exception: text("exception"),
    importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    assignedAt: text("assigned_at"),
    lastCheckedAt: text("last_checked_at"),
  },
  (table) => [
    uniqueIndex("backup_accounts_email_unique").on(table.email),
  ],
);

export const cronJobs = sqliteTable(
  "cron_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("cron_jobs_key_unique").on(table.key)],
);

export const jobRuns = sqliteTable("job_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobKey: text("job_key").notNull(),
  status: text("status").notNull(),
  message: text("message"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  rawJson: text("raw_json"),
});

export const replenishmentRecords = sqliteTable("replenishment_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  status: text("status").notNull(),
  cpaInstanceId: integer("cpa_instance_id").references(() => cpaInstances.id, {
    onDelete: "set null",
  }),
  cpaInstanceName: text("cpa_instance_name"),
  backupAccountId: integer("backup_account_id").references(() => backupAccounts.id, {
    onDelete: "set null",
  }),
  email: text("email"),
  authFileName: text("auth_file_name"),
  reasonCodes: text("reason_codes"),
  error: text("error"),
  rawJson: text("raw_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type CpaInstance = typeof cpaInstances.$inferSelect;
export type NewCpaInstance = typeof cpaInstances.$inferInsert;
export type AuthFile = typeof authFiles.$inferSelect;
export type BackupAccount = typeof backupAccounts.$inferSelect;
export type CronJob = typeof cronJobs.$inferSelect;
export type DashboardMetricSnapshot = typeof dashboardMetricSnapshots.$inferSelect;
export type Proxy = typeof proxies.$inferSelect;
export type ReplenishmentRecord = typeof replenishmentRecords.$inferSelect;
export type ReplenishmentStrategy = typeof replenishmentStrategies.$inferSelect;
