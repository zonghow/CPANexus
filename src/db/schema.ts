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
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_files_instance_file_unique").on(
      table.cpaInstanceId,
      table.fileName,
    ),
  ],
);

export const exceptionAuthFiles = sqliteTable(
  "exception_auth_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceCpaInstanceId: integer("source_cpa_instance_id"),
    sourceCpaInstanceName: text("source_cpa_instance_name").notNull(),
    fileName: text("file_name").notNull(),
    email: text("email"),
    lastError: text("last_error"),
    rawJson: text("raw_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("exception_auth_files_file_unique").on(table.fileName),
  ],
);

export const candidateAuthFiles = sqliteTable(
  "candidate_auth_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileName: text("file_name").notNull(),
    email: text("email"),
    provider: text("provider"),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    status: text("status"),
    statusMessage: text("status_message"),
    rawJson: text("raw_json").notNull(),
    quotaRawJson: text("quota_raw_json"),
    usage5hPercent: real("usage_5h_percent"),
    usageWeekPercent: real("usage_week_percent"),
    lastQuotaRefreshedAt: text("last_quota_refreshed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("candidate_auth_files_file_unique").on(table.fileName),
    index("candidate_auth_files_email_idx").on(table.email),
    index("candidate_auth_files_updated_at_idx").on(table.updatedAt),
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

export const cpaInstanceSyncRuns = sqliteTable("cpa_instance_sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cpaInstanceId: integer("cpa_instance_id")
    .notNull()
    .references(() => cpaInstances.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  message: text("message"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  rawJson: text("raw_json"),
});

export const messagePushPolicies = sqliteTable("message_push_policies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  deliveryType: text("delivery_type").notNull().default("webhook"),
  triggerType: text("trigger_type").notNull(),
  thresholdPercent: real("threshold_percent"),
  scopeType: text("scope_type").notNull().default("all_enabled"),
  webhookUrl: text("webhook_url").notNull(),
  headersJson: text("headers_json").notNull().default("{}"),
  bodyTemplate: text("body_template").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const messagePushPolicyCpaInstances = sqliteTable(
  "message_push_policy_cpa_instances",
  {
    policyId: integer("policy_id")
      .notNull()
      .references(() => messagePushPolicies.id, { onDelete: "cascade" }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.policyId, table.cpaInstanceId] }),
    index("message_push_policy_cpa_instances_cpa_idx").on(table.cpaInstanceId),
  ],
);

export const messagePushStates = sqliteTable(
  "message_push_states",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    policyId: integer("policy_id")
      .notNull()
      .references(() => messagePushPolicies.id, { onDelete: "cascade" }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
    triggerKey: text("trigger_key").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    activatedAt: text("activated_at"),
    recoveredAt: text("recovered_at"),
    lastSentAt: text("last_sent_at"),
    lastValue: real("last_value"),
    lastMessage: text("last_message"),
  },
  (table) => [
    uniqueIndex("message_push_states_unique").on(
      table.policyId,
      table.cpaInstanceId,
      table.triggerKey,
    ),
  ],
);

export const messagePushDeliveries = sqliteTable(
  "message_push_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    policyId: integer("policy_id")
      .notNull()
      .references(() => messagePushPolicies.id, { onDelete: "cascade" }),
    cpaInstanceId: integer("cpa_instance_id")
      .notNull()
      .references(() => cpaInstances.id, { onDelete: "cascade" }),
    deliveryType: text("delivery_type").notNull().default("webhook"),
    triggerKey: text("trigger_key").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    sentAt: text("sent_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("message_push_deliveries_policy_time_idx").on(
      table.policyId,
      table.sentAt,
    ),
  ],
);

export type CpaInstance = typeof cpaInstances.$inferSelect;
export type NewCpaInstance = typeof cpaInstances.$inferInsert;
export type AuthFile = typeof authFiles.$inferSelect;
export type ExceptionAuthFile = typeof exceptionAuthFiles.$inferSelect;
export type CronJob = typeof cronJobs.$inferSelect;
export type DashboardMetricSnapshot = typeof dashboardMetricSnapshots.$inferSelect;
export type Proxy = typeof proxies.$inferSelect;
export type MessagePushPolicy = typeof messagePushPolicies.$inferSelect;
