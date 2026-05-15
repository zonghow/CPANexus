import { and, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  backupAccounts,
  cpaInstances,
  cronJobs,
  dashboardMetricSnapshots,
  jobRuns,
  proxies,
  proxyCpaInstances,
  quotaSnapshots,
  replenishmentRecords,
  replenishmentStrategies,
  type AuthFile,
  type BackupAccount,
  type CpaInstance,
} from "@/db/schema";

import { buildDashboardMetricSnapshot } from "./data-board";
import {
  downloadRemoteAuthFile,
  listRemoteAuthFiles,
  patchRemoteAuthFileFields,
  refreshRemoteQuotas,
  uploadRemoteAuthFile,
  type RemoteAuthFile,
} from "./cpa-client";
import {
  buildAutoAuthFileName,
  buildCodexAuthPayload,
} from "./replacement-accounts";
import { planReplenishment } from "./replenishment";

export const jobKeys = {
  sync: "sync-cpa-instances",
} as const;

const quotaPendingStatus = "待配额刷新";
const quotaPendingMessage = "等待配额刷新接口返回结果";

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

type ReplenishmentRecordSource = "auto" | "manual" | "quick";

export async function runJobByKey(jobKey: string): Promise<JobRunResult> {
  if (jobKey === jobKeys.sync) {
    return recordJobRun(jobKey, () => syncCpaInstancesAndAutoReplenish());
  }

  throw new Error(`Unknown job key: ${jobKey}`);
}

async function syncCpaInstancesAndAutoReplenish(): Promise<JobRunResult> {
  const syncResult = await syncCpaInstances();
  const replenishResult = await autoReplenish();
  const status = syncResult.status === "error" || replenishResult.status === "error"
    ? "error"
    : "success";

  return {
    status,
    message: `${syncResult.message}；${replenishResult.message}`,
    details: {
      sync: syncResult.details,
      replenishment: replenishResult.details,
    },
  };
}

export async function syncCpaInstances(): Promise<JobRunResult> {
  const instances = db
    .select()
    .from(cpaInstances)
    .where(eq(cpaInstances.enabled, true))
    .all();

  const details: CpaInstanceSyncResult[] = [];

  for (const instance of instances) {
    details.push(await syncCpaInstance(instance));
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
  try {
    const remoteFiles = await listRemoteAuthFiles(instance);
    await syncAuthFilesForInstance(instance, remoteFiles);
    const quotaResult = await syncQuotasForInstance(instance, remoteFiles);
    recordDashboardMetricSnapshot(instance.id, nowIso());

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
      message: `synced ${remoteFiles.length} auth files, ${quotaResult} quota snapshots`,
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

export async function autoReplenish(): Promise<JobRunResult> {
  const strategies = db
    .select()
    .from(replenishmentStrategies)
    .where(eq(replenishmentStrategies.enabled, true))
    .all();

  const details: Array<{ instance: string; uploaded: number; reasons: string[]; error?: string }> = [];

  for (const strategy of strategies) {
    const instance = db
      .select()
      .from(cpaInstances)
      .where(and(eq(cpaInstances.id, strategy.cpaInstanceId), eq(cpaInstances.enabled, true)))
      .get();
    if (!instance) {
      continue;
    }

    let recordedUploadError = false;
    try {
      const localAuthFiles = db
        .select()
        .from(authFiles)
        .where(eq(authFiles.cpaInstanceId, instance.id))
        .all();
      const allAuthFiles = db.select().from(authFiles).all();
      const latestSnapshots = db
        .select()
        .from(quotaSnapshots)
        .where(eq(quotaSnapshots.cpaInstanceId, instance.id))
        .orderBy(desc(quotaSnapshots.capturedAt))
        .limit(200)
        .all();
      const candidates = db
        .select()
        .from(backupAccounts)
        .where(sql`${backupAccounts.assignedCpaInstanceId} IS NULL`)
        .orderBy(backupAccounts.importedAt)
        .all();
      const proxyCandidates = loadProxyCandidates(instance.id, allAuthFiles);

      const plan = planReplenishment({
        cpaInstanceId: instance.id,
        strategy,
        authFiles: localAuthFiles.map((authFile) => ({
          email: authFile.email,
          available: authFile.available,
        })),
        quotaSnapshots: latestSnapshots.map((snapshot) => ({
          email: snapshot.email,
          usage5hPercent: snapshot.usage5hPercent,
          usageWeekPercent: snapshot.usageWeekPercent,
          available: snapshot.available,
        })),
        backupAccounts: candidates.map((account) => ({
          id: account.id,
          email: account.email,
          refreshToken: account.refreshToken,
          assignedCpaInstanceId: account.assignedCpaInstanceId,
          exception: account.exception,
        })),
        proxies: proxyCandidates,
      });

      let uploaded = 0;
      for (const account of plan.accountsToUpload) {
        try {
          const uploadedAccount = await uploadBackupAccount(instance, account);
          recordReplenishment({
            source: "auto",
            status: "success",
            instance,
            account,
            authFileName: uploadedAccount.fileName,
            reasonCodes: plan.reasonCodes,
          });
          uploaded += 1;
        } catch (error) {
          recordedUploadError = true;
          recordReplenishment({
            source: "auto",
            status: "error",
            instance,
            account,
            authFileName: buildAutoAuthFileName(account.email),
            reasonCodes: plan.reasonCodes,
            error,
          });
          throw error;
        }
      }

      details.push({
        instance: instance.name,
        uploaded,
        reasons: plan.reasonCodes,
      });
    } catch (error) {
      details.push({
        instance: instance.name,
        uploaded: 0,
        reasons: [],
        error: error instanceof Error ? error.message : String(error),
      });
      if (!recordedUploadError) {
        recordReplenishment({
          source: "auto",
          status: "error",
          instance,
          error,
        });
      }
    }
  }

  const uploaded = details.reduce((sum, detail) => sum + detail.uploaded, 0);
  const failed = details.filter((detail) => detail.error).length;

  return {
    status: failed > 0 ? "error" : "success",
    message: `自动补号完成：上传 ${uploaded} 个，失败实例 ${failed} 个`,
    details,
  };
}

export async function manualReplenishCpaInstance(
  cpaInstanceId: number,
  options: { count?: number; backupAccountIds?: number[]; source?: "manual" | "quick" },
) {
  const instance = db
    .select()
    .from(cpaInstances)
    .where(and(eq(cpaInstances.id, cpaInstanceId), eq(cpaInstances.enabled, true)))
    .get();
  if (!instance) {
    throw new Error("CPA instance not found or disabled");
  }

  const requestedIds = options.backupAccountIds?.filter((id) => Number.isInteger(id) && id > 0) ?? [];
  const source = options.source ?? (requestedIds.length > 0 ? "manual" : "quick");
  const count = Math.max(1, Math.min(50, Math.floor(options.count ?? requestedIds.length)));
  const idleAvailableFilter = and(
    sql`${backupAccounts.assignedCpaInstanceId} IS NULL`,
    sql`${backupAccounts.exception} IS NULL`,
  );
  let recordedUploadError = false;

  try {
    const accounts =
      requestedIds.length > 0
        ? db
            .select()
            .from(backupAccounts)
            .where(and(inArray(backupAccounts.id, requestedIds), idleAvailableFilter))
            .orderBy(backupAccounts.importedAt)
            .all()
        : db
            .select()
            .from(backupAccounts)
            .where(idleAvailableFilter)
            .orderBy(backupAccounts.importedAt)
            .limit(count)
            .all();

    if (requestedIds.length > 0 && accounts.length !== requestedIds.length) {
      throw new Error("选择的替补账号不可用或已被归属");
    }

    if (requestedIds.length === 0 && accounts.length < count) {
      const availableCount = db
        .select({ count: sql<number>`count(*)` })
        .from(backupAccounts)
        .where(idleAvailableFilter)
        .get()?.count ?? 0;
      throw new Error(`替补号池可用数量不足：需要 ${count} 个，当前可用 ${availableCount} 个`);
    }

    const allAuthFiles = db.select().from(authFiles).all();
    const proxyPicker = createManualProxyPicker(instance.id, loadProxyCandidates(instance.id, allAuthFiles));
    const uploaded: Array<{ id: number; email: string; fileName: string }> = [];

    for (const account of accounts.slice(0, count)) {
      const uploadInput = {
        id: account.id,
        email: account.email,
        refreshToken: account.refreshToken,
        proxy: proxyPicker(),
      };
      try {
        const uploadedAccount = await uploadBackupAccount(instance, uploadInput);
        uploaded.push(uploadedAccount);
        recordReplenishment({
          source,
          status: "success",
          instance,
          account,
          authFileName: uploadedAccount.fileName,
        });
      } catch (error) {
        recordedUploadError = true;
        recordReplenishment({
          source,
          status: "error",
          instance,
          account,
          authFileName: buildAutoAuthFileName(account.email),
          error,
        });
        throw error;
      }
    }

    return {
      uploaded: uploaded.length,
      requested: requestedIds.length > 0 ? requestedIds.length : count,
      accounts: uploaded,
    };
  } catch (error) {
    if (!recordedUploadError) {
      recordReplenishment({
        source,
        status: "error",
        instance,
        error,
      });
    }
    throw error;
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
      db.insert(quotaSnapshots)
        .values({
          cpaInstanceId: instance.id,
          authFileName: snapshot.authFileName,
          email: snapshot.email,
          usage5hPercent: snapshot.usage5hPercent,
          usageWeekPercent: snapshot.usageWeekPercent,
          available: snapshot.available,
          exception: snapshot.exception,
          rawJson: JSON.stringify(snapshot.raw),
          capturedAt,
        })
        .run();

      updateAuthFileAvailabilityFromQuota(instance.id, snapshot);

      if (snapshot.email) {
        db.update(backupAccounts)
          .set({
            exception: snapshot.exception,
            lastCheckedAt: capturedAt,
            status: snapshot.exception ? "error" : sql`CASE WHEN assigned_cpa_instance_id IS NULL THEN status ELSE 'assigned' END`,
          })
          .where(eq(backupAccounts.email, snapshot.email))
          .run();
      }
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

    let rawJson: string | null = JSON.stringify(remoteFile);
    let downloadedProxyUrl: string | null = null;
    try {
      const downloaded = await downloadRemoteAuthFile(instance, fileName);
      downloadedProxyUrl = proxyUrlFromDownloadedAuthFile(downloaded);
      rawJson = JSON.stringify(downloaded);
    } catch {
      rawJson = JSON.stringify(remoteFile);
    }
    const proxyUrl = stringOrNull(remoteFile.proxy_url) ?? downloadedProxyUrl;

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
        lastSyncedAt: nowIso(),
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
          proxyUrl,
          size: typeof remoteFile.size === "number" ? remoteFile.size : null,
          rawJson,
          lastSyncedAt: nowIso(),
        },
      })
      .run();
  }
}

async function syncQuotasForInstance(instance: CpaInstance, remoteFiles?: RemoteAuthFile[]) {
  const snapshots = await refreshRemoteQuotas(instance, remoteFiles);
  const capturedAt = nowIso();

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
    db.insert(quotaSnapshots)
      .values({
        cpaInstanceId: instance.id,
        authFileName: snapshot.authFileName,
        email: snapshot.email,
        usage5hPercent: snapshot.usage5hPercent,
        usageWeekPercent: snapshot.usageWeekPercent,
        available: snapshot.available,
        exception: snapshot.exception,
        rawJson: JSON.stringify(snapshot.raw),
        capturedAt,
      })
      .run();

    updateAuthFileAvailabilityFromQuota(instance.id, snapshot);

    if (snapshot.email) {
      db.update(backupAccounts)
        .set({
          exception: snapshot.exception,
          lastCheckedAt: capturedAt,
          status: snapshot.exception ? "error" : sql`CASE WHEN assigned_cpa_instance_id IS NULL THEN status ELSE 'assigned' END`,
        })
        .where(eq(backupAccounts.email, snapshot.email))
        .run();
    }
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

function deleteQuotaSnapshotsForAuthFile(authFile: AuthFile) {
  const emailCondition = authFile.email
    ? sql`lower(${quotaSnapshots.email}) = ${authFile.email.toLowerCase()}`
    : null;
  const identityCondition = emailCondition
    ? or(eq(quotaSnapshots.authFileName, authFile.fileName), emailCondition)
    : eq(quotaSnapshots.authFileName, authFile.fileName);

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

function parseRecord(rawJson: string | null): Record<string, unknown> {
  if (!rawJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function loadProxyCandidates(instanceId: number, localAuthFiles: AuthFile[]) {
  const allProxies = db
    .select()
    .from(proxies)
    .where(eq(proxies.enabled, true))
    .all();
  if (allProxies.length === 0) {
    return [];
  }

  const proxyIds = allProxies.map((proxy) => proxy.id);
  const allowedRows = db
    .select()
    .from(proxyCpaInstances)
    .where(inArray(proxyCpaInstances.proxyId, proxyIds))
    .all();

  return allProxies.map((proxy) => ({
    id: proxy.id,
    url: proxy.url,
    maxAuthFiles: proxy.maxAuthFiles,
    currentAuthFiles: localAuthFiles.filter((authFile) => authFile.proxyUrl === proxy.url).length,
    cpaInstanceIds: allowedRows
      .filter((row) => row.proxyId === proxy.id)
      .map((row) => row.cpaInstanceId)
      .filter((id) => id === instanceId),
  }));
}

function createManualProxyPicker(
  cpaInstanceId: number,
  proxies: Array<{
    id: number;
    url: string;
    maxAuthFiles: number;
    currentAuthFiles: number;
    cpaInstanceIds: number[];
  }>,
) {
  const mutable = proxies
    .filter(
      (proxy) =>
        proxy.url.trim() &&
        proxy.cpaInstanceIds.includes(cpaInstanceId) &&
        proxy.currentAuthFiles < proxy.maxAuthFiles,
    )
    .map((proxy) => ({ ...proxy }));

  return () => {
    const proxy = mutable.find((candidate) => candidate.currentAuthFiles < candidate.maxAuthFiles);
    if (!proxy) {
      return null;
    }

    proxy.currentAuthFiles += 1;
    return { id: proxy.id, url: proxy.url };
  };
}

async function uploadBackupAccount(
  instance: CpaInstance,
  account: {
    id: number;
    email: string;
    refreshToken: string;
    proxy?: { id: number; url: string } | null;
  },
) {
  const fileName = buildAutoAuthFileName(account.email);
  const payload = buildCodexAuthPayload(account);
  await uploadRemoteAuthFile(instance, fileName, payload);
  if (account.proxy) {
    await patchRemoteAuthFileFields(instance, fileName, {
      proxy_url: account.proxy.url,
      note: "uploaded by CPA Nexus auto replenish",
    });
  }

  const assignedAt = nowIso();
  db.update(backupAccounts)
    .set({
      status: "assigned",
      assignedCpaInstanceId: instance.id,
      assignedAuthFileName: fileName,
      assignedAt,
      exception: null,
      lastCheckedAt: assignedAt,
    })
    .where(eq(backupAccounts.id, account.id))
    .run();

  db.insert(authFiles)
    .values({
      cpaInstanceId: instance.id,
      fileName,
      email: account.email,
      provider: "codex",
      status: "uploaded",
      statusMessage: "uploaded by CPA Nexus auto replenish",
      available: true,
      proxyUrl: account.proxy?.url ?? null,
      rawJson: JSON.stringify(payload),
      lastSyncedAt: assignedAt,
    })
    .onConflictDoUpdate({
      target: [authFiles.cpaInstanceId, authFiles.fileName],
      set: {
        email: account.email,
        provider: "codex",
        status: "uploaded",
        statusMessage: "uploaded by CPA Nexus auto replenish",
        available: true,
        proxyUrl: account.proxy?.url ?? null,
        rawJson: JSON.stringify(payload),
        lastSyncedAt: assignedAt,
      },
    })
    .run();

  return {
    id: account.id,
    email: account.email,
    fileName,
  };
}

function recordReplenishment(input: {
  source: ReplenishmentRecordSource;
  status: "success" | "error";
  instance: CpaInstance;
  account?: Pick<BackupAccount, "id" | "email"> | null;
  authFileName?: string | null;
  reasonCodes?: string[] | null;
  error?: unknown;
  raw?: unknown;
}) {
  db.insert(replenishmentRecords)
    .values({
      source: input.source,
      status: input.status,
      cpaInstanceId: input.instance.id,
      cpaInstanceName: input.instance.name,
      backupAccountId: input.account?.id ?? null,
      email: input.account?.email ?? null,
      authFileName: input.authFileName ?? null,
      reasonCodes: input.reasonCodes?.length ? JSON.stringify(input.reasonCodes) : null,
      error: input.error === undefined ? null : errorMessage(input.error),
      rawJson: input.raw === undefined ? null : JSON.stringify(input.raw),
      createdAt: nowIso(),
    })
    .run();
}

async function recordJobRun(
  jobKey: string,
  run: () => Promise<JobRunResult>,
): Promise<JobRunResult> {
  const startedAt = nowIso();

  try {
    const result = await run();
    const finishedAt = nowIso();
    db.insert(jobRuns)
      .values({
        jobKey,
        status: result.status,
        message: result.message,
        startedAt,
        finishedAt,
        rawJson: JSON.stringify(result.details ?? null),
      })
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
    db.insert(jobRuns)
      .values({
        jobKey,
        status: "error",
        message,
        startedAt,
        finishedAt,
      })
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
