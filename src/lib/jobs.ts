import { and, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  cpaInstanceSyncRuns,
  cpaInstances,
  cronJobs,
  dashboardMetricSnapshots,
  jobRuns,
  proxies,
  proxyCpaInstances,
  quotaSnapshots,
  type AuthFile,
  type CpaInstance,
} from "@/db/schema";

import { buildDashboardMetricSnapshot } from "./data-board";
import {
  downloadRemoteAuthFile,
  listRemoteAuthFiles,
  refreshRemoteQuotas,
  type RemoteAuthFile,
} from "./cpa-client";
import { evaluateMessagePushPoliciesForCpa } from "./message-push";
import type { NormalizedQuotaSnapshot } from "./quota";

export const jobKeys = {
  sync: "sync-cpa-instances",
} as const;

const quotaPendingStatus = "待配额刷新";
const quotaPendingMessage = "等待配额刷新接口返回结果";
const jobRunningMessage = "当前有同步任务正在进行中";
const authPayloadDownloadConcurrency = 6;

export class JobAlreadyRunningError extends Error {
  constructor() {
    super(jobRunningMessage);
    this.name = "JobAlreadyRunningError";
  }
}

export function isJobAlreadyRunningError(error: unknown) {
  return error instanceof JobAlreadyRunningError;
}

export class CpaInstanceAlreadySyncingError extends Error {
  constructor(public readonly instance: Pick<CpaInstance, "id" | "name">) {
    super(`CPA ${instance.name} 正在同步中`);
    this.name = "CpaInstanceAlreadySyncingError";
  }
}

export function isCpaInstanceAlreadySyncingError(error: unknown) {
  return error instanceof CpaInstanceAlreadySyncingError;
}

const staleRunMaxAgeMs = 15 * 60 * 1000;
const staleRunMessage = "运行中断（进程重启或超时），已自动清理";

/**
 * Releases stale run locks left behind when a process is killed mid-run (e.g. a
 * deploy restart), which would otherwise block all future runs forever via the
 * partial unique indexes on unfinished runs. Any unfinished run older than
 * `maxAgeMs` is marked finished so scheduling can resume. Safe to call
 * repeatedly; the age threshold avoids touching legitimately in-flight runs.
 */
export function reclaimStaleRuns(now: Date = new Date(), maxAgeMs = staleRunMaxAgeMs) {
  const cutoffIso = new Date(now.getTime() - maxAgeMs).toISOString();
  const finishedAt = now.toISOString();

  const staleJobRuns = db
    .update(jobRuns)
    .set({ status: "error", message: staleRunMessage, finishedAt })
    .where(and(isNull(jobRuns.finishedAt), lt(jobRuns.startedAt, cutoffIso)))
    .returning({ jobKey: jobRuns.jobKey })
    .all();

  for (const { jobKey } of staleJobRuns) {
    db.update(cronJobs)
      .set({
        lastStatus: "error",
        lastError: staleRunMessage,
        lastRunAt: finishedAt,
        updatedAt: finishedAt,
      })
      .where(and(eq(cronJobs.key, jobKey), eq(cronJobs.lastStatus, "running")))
      .run();
  }

  const staleSyncRuns = db
    .update(cpaInstanceSyncRuns)
    .set({ status: "error", message: staleRunMessage, finishedAt })
    .where(
      and(
        isNull(cpaInstanceSyncRuns.finishedAt),
        lt(cpaInstanceSyncRuns.startedAt, cutoffIso),
      ),
    )
    .returning({ id: cpaInstanceSyncRuns.id })
    .all();

  return staleJobRuns.length + staleSyncRuns.length;
}

export type JobRunResult = {
  status: "success" | "error";
  message: string;
  details?: unknown;
};

export type CpaInstanceSyncResult = {
  instance: string;
  status: "success" | "error";
  message: string;
};

type CpaInstanceSyncPhase = "auth_files" | "auth_payloads" | "quotas";

export async function runJobByKey(jobKey: string): Promise<JobRunResult> {
  if (jobKey === jobKeys.sync) {
    return recordJobRun(jobKey, () => syncCpaInstances());
  }

  throw new Error(`Unknown job key: ${jobKey}`);
}

export async function syncCpaInstances(): Promise<JobRunResult> {
  const instances = db
    .select()
    .from(cpaInstances)
    .where(eq(cpaInstances.enabled, true))
    .all();

  const details: CpaInstanceSyncResult[] = [];

  for (const instance of instances) {
    try {
      details.push(await syncCpaInstance(instance));
    } catch (error) {
      if (!isCpaInstanceAlreadySyncingError(error)) {
        throw error;
      }
      details.push({
        instance: instance.name,
        status: "error",
        message: `${error.message}，已跳过`,
      });
    }
  }

  const failed = details.filter((detail) => detail.status === "error").length;
  return {
    status: failed > 0 ? "error" : "success",
    message: `同步完成：${details.length - failed} 成功，${failed} 失败`,
    details,
  };
}

export async function syncCpaInstanceById(cpaInstanceId: number) {
  const instance = db
    .select()
    .from(cpaInstances)
    .where(and(eq(cpaInstances.id, cpaInstanceId), eq(cpaInstances.enabled, true)))
    .get();

  if (!instance) {
    throw new Error("CPA instance not found or disabled");
  }

  return syncCpaInstance(instance);
}

async function syncCpaInstance(instance: CpaInstance): Promise<CpaInstanceSyncResult> {
  return recordCpaInstanceSyncRun(instance, (runId) =>
    performCpaInstanceSync(instance, runId),
  );
}

async function performCpaInstanceSync(
  instance: CpaInstance,
  syncRunId: number,
): Promise<CpaInstanceSyncResult> {
  try {
    const remoteFiles = await listRemoteAuthFiles(instance);
    await syncAuthFilesForInstance(instance, remoteFiles);
    updateCpaInstanceSyncRunPhase(syncRunId, "auth_payloads", "补全认证文件中");
    const payloadResult = await syncAuthFilePayloadsForInstance(instance, remoteFiles);
    updateCpaInstanceSyncRunPhase(syncRunId, "quotas", "刷新配额中");
    const quotaResult = await syncQuotasForInstance(instance, remoteFiles);
    recordDashboardMetricSnapshot(instance.id, nowIso());
    await evaluateMessagePushPoliciesForCpa(instance.id);

    db.update(cpaInstances)
      .set({
        lastSyncedAt: nowIso(),
        lastSyncStatus: "success",
        lastSyncError: null,
        updatedAt: nowIso(),
      })
      .where(eq(cpaInstances.id, instance.id))
      .run();

    return {
      instance: instance.name,
      status: "success",
      message: `synced ${remoteFiles.length} auth files, ${payloadResult.downloaded} auth payloads, ${quotaResult} quota snapshots`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(cpaInstances)
      .set({
        lastSyncedAt: nowIso(),
        lastSyncStatus: "error",
        lastSyncError: message,
        updatedAt: nowIso(),
      })
      .where(eq(cpaInstances.id, instance.id))
      .run();

    return {
      instance: instance.name,
      status: "error",
      message,
    };
  }
}

export async function refreshAuthFileQuotaById(authFileId: number): Promise<CpaInstanceSyncResult> {
  const authFile = db.select().from(authFiles).where(eq(authFiles.id, authFileId)).get();
  if (!authFile) {
    throw new Error("auth file not found");
  }

  const instance = db
    .select()
    .from(cpaInstances)
    .where(eq(cpaInstances.id, authFile.cpaInstanceId))
    .get();
  if (!instance) {
    throw new Error("CPA instance not found");
  }

  try {
    const remoteFile = remoteAuthFileFromLocal(authFile);
    const snapshots = matchingQuotaSnapshots(
      authFile,
      await refreshRemoteQuotas(instance, [remoteFile]),
    );
    const capturedAt = nowIso();

    const previousUsage = loadPreviousUsageByAccount(
      db
        .select()
        .from(quotaSnapshots)
        .where(quotaSnapshotIdentityCondition(authFile))
        .all(),
    );

    deleteQuotaSnapshotsForAuthFile(authFile);

    if (snapshots.length === 0) {
      db.update(authFiles)
        .set({
          available: false,
          status: "异常",
          statusMessage: "配额刷新未返回该账号",
          lastSyncedAt: capturedAt,
        })
        .where(eq(authFiles.id, authFile.id))
        .run();

      return {
        instance: instance.name,
        status: "error",
        message: "配额刷新未返回该账号",
      };
    }

    for (const snapshot of snapshots) {
      const prev = carryForwardUsage(snapshot, previousUsage);
      db.insert(quotaSnapshots)
        .values({
          cpaInstanceId: instance.id,
          authFileName: snapshot.authFileName,
          email: snapshot.email,
          usage5hPercent: snapshot.usage5hPercent,
          usageWeekPercent: snapshot.usageWeekPercent,
          prevUsage5hPercent: prev.prevUsage5hPercent,
          prevUsageWeekPercent: prev.prevUsageWeekPercent,
          available: snapshot.available,
          exception: snapshot.exception,
          rawJson: JSON.stringify(snapshot.raw),
          capturedAt,
        })
        .run();

      updateAuthFileAvailabilityFromQuota(instance.id, snapshot);
    }

    db.update(authFiles)
      .set({ lastSyncedAt: capturedAt })
      .where(eq(authFiles.id, authFile.id))
      .run();

    return {
      instance: instance.name,
      status: "success",
      message: `refreshed ${snapshots.length} quota snapshot${snapshots.length === 1 ? "" : "s"}`,
    };
  } catch (error) {
    return {
      instance: instance.name,
      status: "error",
      message: errorMessage(error),
    };
  }
}

async function syncAuthFilesForInstance(
  instance: CpaInstance,
  remoteFiles: RemoteAuthFile[],
) {
  const remoteFileNames = remoteFiles
    .map((remoteFile) => remoteFile.name?.trim())
    .filter((fileName): fileName is string => Boolean(fileName));

  if (remoteFileNames.length > 0) {
    db.delete(authFiles)
      .where(
        and(
          eq(authFiles.cpaInstanceId, instance.id),
          notInArray(authFiles.fileName, remoteFileNames),
        ),
      )
      .run();
  } else {
    db.delete(authFiles)
      .where(eq(authFiles.cpaInstanceId, instance.id))
      .run();
  }

  for (const remoteFile of remoteFiles) {
    const fileName = remoteFile.name?.trim();
    if (!fileName) {
      continue;
    }

    const rawJson = JSON.stringify(remoteFile);
    const proxyUrl = stringOrNull(remoteFile.proxy_url);
    const syncedAt = nowIso();
    const createdAt = authFileCreatedAt(remoteFile) ?? syncedAt;

    db.insert(authFiles)
      .values({
        cpaInstanceId: instance.id,
        remoteId: stringOrNull(remoteFile.id),
        authIndex: stringOrNull(remoteFile.auth_index),
        fileName,
        email: stringOrNull(remoteFile.email),
        provider: stringOrNull(remoteFile.provider ?? remoteFile.type),
        label: stringOrNull(remoteFile.label),
        status: quotaPendingStatus,
        statusMessage: quotaPendingMessage,
        disabled: Boolean(remoteFile.disabled),
        available: false,
        proxyUrl,
        size: typeof remoteFile.size === "number" ? remoteFile.size : null,
        rawJson,
        createdAt,
        lastSyncedAt: syncedAt,
      })
      .onConflictDoUpdate({
        target: [authFiles.cpaInstanceId, authFiles.fileName],
        set: {
          remoteId: stringOrNull(remoteFile.id),
          authIndex: stringOrNull(remoteFile.auth_index),
          email: stringOrNull(remoteFile.email),
          provider: stringOrNull(remoteFile.provider ?? remoteFile.type),
          label: stringOrNull(remoteFile.label),
          status: quotaPendingStatus,
          statusMessage: quotaPendingMessage,
          disabled: Boolean(remoteFile.disabled),
          available: false,
          proxyUrl: proxyUrl ?? sql`${authFiles.proxyUrl}`,
          size: typeof remoteFile.size === "number" ? remoteFile.size : null,
          rawJson: sql`
            CASE
              WHEN ${authFiles.rawJson} IS NULL OR trim(${authFiles.rawJson}) = '' THEN ${rawJson}
              ELSE ${authFiles.rawJson}
            END
          `,
          createdAt: sql`
            CASE
              WHEN ${authFiles.createdAt} IS NULL OR trim(${authFiles.createdAt}) = '' THEN ${createdAt}
              WHEN ${createdAt} < ${authFiles.createdAt} THEN ${createdAt}
              ELSE ${authFiles.createdAt}
            END
          `,
          lastSyncedAt: syncedAt,
        },
      })
      .run();
  }
}

async function syncAuthFilePayloadsForInstance(
  instance: CpaInstance,
  remoteFiles: RemoteAuthFile[],
) {
  let downloaded = 0;

  await mapWithConcurrency(
    remoteFiles,
    authPayloadDownloadConcurrency,
    async (remoteFile) => {
      const fileName = remoteFile.name?.trim();
      if (!fileName) {
        return;
      }

      try {
        const payload = await downloadRemoteAuthFile(instance, fileName);
        if (updateDownloadedAuthFilePayload(instance.id, remoteFile, payload)) {
          downloaded += 1;
        }
      } catch {
        // Full auth payload download is a best-effort cache warmup. Operations
        // that need the payload still download it on demand before falling back.
      }
    },
  );

  return { downloaded };
}

function updateDownloadedAuthFilePayload(
  cpaInstanceId: number,
  remoteFile: RemoteAuthFile,
  payload: unknown,
) {
  const fileName = remoteFile.name.trim();
  const rawJson = JSON.stringify(payload);
  if (!rawJson) {
    return false;
  }

  const proxyUrl =
    stringOrNull(remoteFile.proxy_url) ?? proxyUrlFromDownloadedAuthFile(payload);
  const downloadedCreatedAt = authFileCreatedAt(payload);
  const updatedAt = nowIso();

  db.update(authFiles)
    .set({
      rawJson,
      proxyUrl,
      createdAt: downloadedCreatedAt
        ? sql`
            CASE
              WHEN ${authFiles.createdAt} IS NULL OR trim(${authFiles.createdAt}) = '' THEN ${downloadedCreatedAt}
              WHEN ${downloadedCreatedAt} < ${authFiles.createdAt} THEN ${downloadedCreatedAt}
              ELSE ${authFiles.createdAt}
            END
          `
        : sql`${authFiles.createdAt}`,
      lastSyncedAt: updatedAt,
    })
    .where(
      and(
        eq(authFiles.cpaInstanceId, cpaInstanceId),
        eq(authFiles.fileName, fileName),
      ),
    )
    .run();

  return true;
}

function authFileCreatedAt(value: unknown) {
  const record = objectRecord(value);
  if (!record) {
    return null;
  }

  for (const key of authFileCreatedAtKeys) {
    const normalized = normalizeTimestamp(record[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

const authFileCreatedAtKeys = [
  "created_at",
  "createdAt",
  "creation_time",
  "creationTime",
  "added_at",
  "addedAt",
  "add_time",
  "addTime",
  "uploaded_at",
  "uploadedAt",
  "upload_time",
  "uploadTime",
  "created",
  "added",
  "uploaded",
];

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    return dateToIso(timestamp);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
    const timestamp = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return dateToIso(timestamp);
  }

  return dateToIso(trimmed);
}

function dateToIso(value: string | number) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

type PreviousUsage = {
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  prevUsage5hPercent: number | null;
  prevUsageWeekPercent: number | null;
};

type QuotaSnapshotIdentity = {
  email: string | null;
  authFileName: string | null;
};

/**
 * Builds a lookup of the last-known usage per account from the snapshots that
 * exist before a sync rebuild. `quota_snapshots` is a current-state table that
 * is deleted and recreated on every sync, so this captures the previous row so
 * we can carry forward usage when an account's refresh fails or it dies.
 */
function loadPreviousUsageByAccount(
  rows: Array<PreviousUsage & QuotaSnapshotIdentity>,
) {
  const byKey = new Map<string, PreviousUsage>();
  for (const row of rows) {
    const usage: PreviousUsage = {
      usage5hPercent: row.usage5hPercent,
      usageWeekPercent: row.usageWeekPercent,
      prevUsage5hPercent: row.prevUsage5hPercent,
      prevUsageWeekPercent: row.prevUsageWeekPercent,
    };
    if (row.email) {
      byKey.set(`email:${row.email.toLowerCase()}`, usage);
    }
    if (row.authFileName) {
      byKey.set(`file:${row.authFileName}`, usage);
    }
  }
  return byKey;
}

/**
 * Returns the freshest known usage for an account: the current value when the
 * probe succeeded, otherwise the last value carried from a previous snapshot.
 */
function carryForwardUsage(
  snapshot: NormalizedQuotaSnapshot,
  previousUsage: Map<string, PreviousUsage>,
) {
  const prev =
    (snapshot.email
      ? previousUsage.get(`email:${snapshot.email.toLowerCase()}`)
      : undefined) ??
    (snapshot.authFileName
      ? previousUsage.get(`file:${snapshot.authFileName}`)
      : undefined);

  return {
    prevUsage5hPercent:
      snapshot.usage5hPercent ??
      prev?.prevUsage5hPercent ??
      prev?.usage5hPercent ??
      null,
    prevUsageWeekPercent:
      snapshot.usageWeekPercent ??
      prev?.prevUsageWeekPercent ??
      prev?.usageWeekPercent ??
      null,
  };
}

async function syncQuotasForInstance(instance: CpaInstance, remoteFiles?: RemoteAuthFile[]) {
  const snapshots = await refreshRemoteQuotas(instance, remoteFiles);
  const capturedAt = nowIso();

  const previousUsage = loadPreviousUsageByAccount(
    db
      .select()
      .from(quotaSnapshots)
      .where(eq(quotaSnapshots.cpaInstanceId, instance.id))
      .all(),
  );

  db.delete(quotaSnapshots)
    .where(eq(quotaSnapshots.cpaInstanceId, instance.id))
    .run();
  db.update(authFiles)
    .set({
      available: false,
      status: quotaPendingStatus,
      statusMessage: quotaPendingMessage,
    })
    .where(eq(authFiles.cpaInstanceId, instance.id))
    .run();

  for (const snapshot of snapshots) {
    const prev = carryForwardUsage(snapshot, previousUsage);
    db.insert(quotaSnapshots)
      .values({
        cpaInstanceId: instance.id,
        authFileName: snapshot.authFileName,
        email: snapshot.email,
        usage5hPercent: snapshot.usage5hPercent,
        usageWeekPercent: snapshot.usageWeekPercent,
        prevUsage5hPercent: prev.prevUsage5hPercent,
        prevUsageWeekPercent: prev.prevUsageWeekPercent,
        available: snapshot.available,
        exception: snapshot.exception,
        rawJson: JSON.stringify(snapshot.raw),
        capturedAt,
      })
      .run();

    updateAuthFileAvailabilityFromQuota(instance.id, snapshot);
  }

  return snapshots.length;
}

function recordDashboardMetricSnapshot(cpaInstanceId: number, capturedAt: string) {
  const snapshot = buildDashboardMetricSnapshot(
    {
      cpaInstances: db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, cpaInstanceId))
        .all(),
      authFiles: db
        .select()
        .from(authFiles)
        .where(eq(authFiles.cpaInstanceId, cpaInstanceId))
        .all(),
      quotaSnapshots: db
        .select()
        .from(quotaSnapshots)
        .where(eq(quotaSnapshots.cpaInstanceId, cpaInstanceId))
        .all(),
      proxies: db.select().from(proxies).all(),
      proxyCpaInstances: db
        .select()
        .from(proxyCpaInstances)
        .where(eq(proxyCpaInstances.cpaInstanceId, cpaInstanceId))
        .all(),
    },
    cpaInstanceId,
    capturedAt,
  );

  if (!snapshot) {
    return;
  }

  db.insert(dashboardMetricSnapshots)
    .values(snapshot)
    .run();
}

function updateAuthFileAvailabilityFromQuota(
  cpaInstanceId: number,
  snapshot: {
    authFileName: string | null;
    email: string | null;
    available: boolean;
    exception: string | null;
  },
) {
  const values = {
    available: snapshot.available,
    status: snapshot.available ? "可用" : "异常",
    statusMessage: snapshot.exception,
  };

  if (snapshot.authFileName) {
    db.update(authFiles)
      .set(values)
      .where(
        and(
          eq(authFiles.cpaInstanceId, cpaInstanceId),
          eq(authFiles.fileName, snapshot.authFileName),
        ),
      )
      .run();
  }

  if (snapshot.email) {
    db.update(authFiles)
      .set(values)
      .where(
        and(
          eq(authFiles.cpaInstanceId, cpaInstanceId),
          sql`lower(${authFiles.email}) = ${snapshot.email.toLowerCase()}`,
        ),
      )
      .run();
  }
}

function quotaSnapshotIdentityCondition(authFile: AuthFile) {
  const emailCondition = authFile.email
    ? sql`lower(${quotaSnapshots.email}) = ${authFile.email.toLowerCase()}`
    : null;
  return emailCondition
    ? or(eq(quotaSnapshots.authFileName, authFile.fileName), emailCondition)
    : eq(quotaSnapshots.authFileName, authFile.fileName);
}

function deleteQuotaSnapshotsForAuthFile(authFile: AuthFile) {
  const identityCondition = quotaSnapshotIdentityCondition(authFile);

  db.delete(quotaSnapshots)
    .where(and(eq(quotaSnapshots.cpaInstanceId, authFile.cpaInstanceId), identityCondition))
    .run();
}

function matchingQuotaSnapshots(
  authFile: AuthFile,
  snapshots: Awaited<ReturnType<typeof refreshRemoteQuotas>>,
) {
  const email = authFile.email?.toLowerCase() ?? null;
  const matched = snapshots.filter((snapshot) => {
    if (snapshot.authFileName && snapshot.authFileName === authFile.fileName) {
      return true;
    }
    if (email && snapshot.email?.toLowerCase() === email) {
      return true;
    }
    return false;
  });

  return matched.length > 0 || snapshots.length !== 1 ? matched : snapshots;
}

function remoteAuthFileFromLocal(authFile: AuthFile): RemoteAuthFile {
  const raw = parseRecord(authFile.rawJson);
  return {
    ...raw,
    name: authFile.fileName,
    email: authFile.email ?? stringOrNull(raw.email) ?? undefined,
    auth_index: authFile.authIndex ?? stringOrNull(raw.auth_index) ?? undefined,
    provider: authFile.provider ?? stringOrNull(raw.provider) ?? undefined,
    type: authFile.provider ?? stringOrNull(raw.type) ?? undefined,
    disabled: authFile.disabled,
    proxy_url: authFile.proxyUrl ?? stringOrNull(raw.proxy_url) ?? undefined,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRecord(rawJson: string | null): Record<string, unknown> {
  if (!rawJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const record = objectRecord(parsed);
    if (record) {
      return record;
    }
  } catch {
    return {};
  }

  return {};
}

async function recordJobRun(
  jobKey: string,
  run: () => Promise<JobRunResult>,
): Promise<JobRunResult> {
  const startedAt = nowIso();
  const runId = insertRunningJobRun(jobKey, startedAt);
  db.update(cronJobs)
    .set({
      lastStatus: "running",
      lastError: null,
      updatedAt: startedAt,
    })
    .where(eq(cronJobs.key, jobKey))
    .run();

  try {
    const result = await run();
    const finishedAt = nowIso();
    db.update(jobRuns)
      .set({
        status: result.status,
        message: result.message,
        finishedAt,
        rawJson: JSON.stringify(result.details ?? null),
      })
      .where(eq(jobRuns.id, runId))
      .run();
    db.update(cronJobs)
      .set({
        lastRunAt: finishedAt,
        lastStatus: result.status,
        lastError: result.status === "error" ? result.message : null,
        updatedAt: finishedAt,
      })
      .where(eq(cronJobs.key, jobKey))
      .run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = nowIso();
    db.update(jobRuns)
      .set({
        status: "error",
        message,
        finishedAt,
      })
      .where(eq(jobRuns.id, runId))
      .run();
    db.update(cronJobs)
      .set({
        lastRunAt: finishedAt,
        lastStatus: "error",
        lastError: message,
        updatedAt: finishedAt,
      })
      .where(eq(cronJobs.key, jobKey))
      .run();
    return { status: "error", message };
  }
}

function insertRunningJobRun(jobKey: string, startedAt: string) {
  try {
    const row = db.insert(jobRuns)
      .values({
        jobKey,
        status: "running",
        message: "同步中",
        startedAt,
      })
      .returning({ id: jobRuns.id })
      .get();
    return row.id;
  } catch (error) {
    if (isSqliteUniqueConstraint(error, "job_runs.job_key")) {
      throw new JobAlreadyRunningError();
    }
    throw error;
  }
}

async function recordCpaInstanceSyncRun(
  instance: CpaInstance,
  run: (runId: number) => Promise<CpaInstanceSyncResult>,
) {
  const startedAt = nowIso();
  const runId = insertRunningCpaInstanceSyncRun(instance, startedAt);

  try {
    const result = await run(runId);
    const finishedAt = nowIso();
    db.update(cpaInstanceSyncRuns)
      .set({
        status: result.status,
        message: result.message,
        finishedAt,
        rawJson: JSON.stringify(result),
      })
      .where(eq(cpaInstanceSyncRuns.id, runId))
      .run();
    return result;
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = nowIso();
    db.update(cpaInstanceSyncRuns)
      .set({
        status: "error",
        message,
        finishedAt,
      })
      .where(eq(cpaInstanceSyncRuns.id, runId))
      .run();
    throw error;
  }
}

function insertRunningCpaInstanceSyncRun(instance: CpaInstance, startedAt: string) {
  try {
    const row = db.insert(cpaInstanceSyncRuns)
      .values({
        cpaInstanceId: instance.id,
        status: "running",
        phase: "auth_files",
        message: "拉取账号中",
        startedAt,
      })
      .returning({ id: cpaInstanceSyncRuns.id })
      .get();
    return row.id;
  } catch (error) {
    if (isSqliteUniqueConstraint(error, "cpa_instance_sync_runs.cpa_instance_id")) {
      throw new CpaInstanceAlreadySyncingError(instance);
    }
    throw error;
  }
}

function updateCpaInstanceSyncRunPhase(
  runId: number,
  phase: CpaInstanceSyncPhase,
  message: string,
) {
  db.update(cpaInstanceSyncRuns)
    .set({ phase, message })
    .where(eq(cpaInstanceSyncRuns.id, runId))
    .run();
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }),
  );
}

function isSqliteUniqueConstraint(error: unknown, targetColumn: string) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "SQLITE_CONSTRAINT_UNIQUE" || (
    typeof message === "string" &&
    message.includes("UNIQUE constraint failed") &&
    message.includes(targetColumn)
  );
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function proxyUrlFromDownloadedAuthFile(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return stringOrNull((value as { proxy_url?: unknown }).proxy_url);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function nowIso() {
  return new Date().toISOString();
}
