import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, backupAccounts, cpaInstances, proxies, proxyCpaInstances, quotaSnapshots } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  parseIntegerId,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import {
  deleteRemoteAuthFile,
  patchRemoteAuthFileFields,
  setRemoteAuthFileDisabled,
} from "@/lib/cpa-client";
import {
  syncCpaInstanceById,
  type CpaInstanceSyncResult,
} from "@/lib/jobs";

export const runtime = "nodejs";

type BatchAction = "delete" | "disable" | "autoAssignProxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const cpaInstanceId = parseIntegerId((await routeParams(context)).id);
    if (!cpaInstanceId) {
      return badRequest("CPA instance id is required");
    }

    const body = await readJson<{ action?: BatchAction; authFileIds?: number[] }>(request);
    if (body.action !== "delete" && body.action !== "disable" && body.action !== "autoAssignProxy") {
      return badRequest("action must be delete, disable, or autoAssignProxy");
    }

    const instance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, cpaInstanceId))
      .get();
    if (!instance) {
      return notFound("CPA instance not found");
    }

    if (body.action === "autoAssignProxy") {
      const result = await autoAssignProxy(instance);
      return okWithOptionalSync({
        action: body.action,
        processed: result.processed,
        skipped: result.skipped,
        sync: await syncAffectedCpaInstance(cpaInstanceId),
      });
    }

    const authFileIds = Array.isArray(body.authFileIds)
      ? [...new Set(body.authFileIds.filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    if (authFileIds.length === 0) {
      return badRequest("authFileIds is required");
    }

    const rows = db
      .select()
      .from(authFiles)
      .where(and(eq(authFiles.cpaInstanceId, cpaInstanceId), inArray(authFiles.id, authFileIds)))
      .orderBy(authFiles.id)
      .all();
    if (rows.length !== authFileIds.length) {
      return badRequest("some auth files do not belong to this CPA instance");
    }

    const updatedAt = new Date().toISOString();
    for (const authFile of rows) {
      if (body.action === "delete") {
        await deleteRemoteAuthFile(instance, authFile.fileName);
        deleteLocalAuthFile(cpaInstanceId, authFile.id, authFile.fileName);
        clearBackupAssignment(cpaInstanceId, authFile.fileName);
      } else {
        await setRemoteAuthFileDisabled(instance, authFile.fileName, true);
        db.update(authFiles)
          .set({
            disabled: true,
            available: false,
            status: "已停用",
            statusMessage: "批量停用异常账号",
            lastSyncedAt: updatedAt,
          })
          .where(eq(authFiles.id, authFile.id))
          .run();
      }
    }

    return okWithOptionalSync({
      action: body.action,
      processed: rows.length,
      sync: await syncAffectedCpaInstance(cpaInstanceId),
    });
  } catch (error) {
    return serverError(error);
  }
}

function deleteLocalAuthFile(cpaInstanceId: number, authFileId: number, fileName: string) {
  db.delete(quotaSnapshots)
    .where(
      and(
        eq(quotaSnapshots.cpaInstanceId, cpaInstanceId),
        eq(quotaSnapshots.authFileName, fileName),
      ),
    )
    .run();
  db.delete(authFiles).where(eq(authFiles.id, authFileId)).run();
}

function clearBackupAssignment(cpaInstanceId: number, fileName: string) {
  const now = new Date().toISOString();
  db.update(backupAccounts)
    .set({
      status: "idle",
      assignedCpaInstanceId: null,
      assignedAuthFileName: null,
      assignedAt: null,
      lastCheckedAt: now,
    })
    .where(
      and(
        eq(backupAccounts.assignedCpaInstanceId, cpaInstanceId),
        eq(backupAccounts.assignedAuthFileName, fileName),
      ),
    )
    .run();
}

async function autoAssignProxy(instance: typeof cpaInstances.$inferSelect) {
  const localAuthFiles = db.select().from(authFiles).all();
  const targetAuthFiles = localAuthFiles
    .filter((authFile) => authFile.cpaInstanceId === instance.id && !authFile.disabled)
    .sort((left, right) => left.id - right.id);
  const unassignedAuthFiles = targetAuthFiles.filter(
    (authFile) => !authFile.proxyUrl?.trim(),
  );
  if (unassignedAuthFiles.length === 0) {
    return { processed: 0, skipped: 0 };
  }

  const candidates = loadProxyCandidates(instance.id, localAuthFiles);
  const updatedAt = new Date().toISOString();
  let processed = 0;
  let skipped = 0;

  for (const authFile of unassignedAuthFiles) {
    const proxy = candidates.find((candidate) => candidate.currentAuthFiles < candidate.maxAuthFiles);
    if (!proxy) {
      skipped += 1;
      continue;
    }

    await patchRemoteAuthFileFields(instance, authFile.fileName, {
      proxy_url: proxy.url,
    });
    db.update(authFiles)
      .set({
        proxyUrl: proxy.url,
        rawJson: authRawJsonWithProxyUrl(authFile.rawJson, proxy.url),
        lastSyncedAt: updatedAt,
      })
      .where(eq(authFiles.id, authFile.id))
      .run();

    proxy.currentAuthFiles += 1;
    processed += 1;
  }

  return { processed, skipped };
}

function loadProxyCandidates(
  cpaInstanceId: number,
  localAuthFiles: Array<typeof authFiles.$inferSelect>,
) {
  const enabledProxies = db
    .select()
    .from(proxies)
    .where(eq(proxies.enabled, true))
    .orderBy(proxies.id)
    .all();
  if (enabledProxies.length === 0) {
    return [];
  }

  const allowedProxyIds = new Set(
    db
      .select()
      .from(proxyCpaInstances)
      .where(inArray(proxyCpaInstances.proxyId, enabledProxies.map((proxy) => proxy.id)))
      .all()
      .filter((row) => row.cpaInstanceId === cpaInstanceId)
      .map((row) => row.proxyId),
  );
  const usageCounts = new Map<string, number>();
  for (const authFile of localAuthFiles) {
    const proxyUrl = authFile.proxyUrl?.trim();
    if (!proxyUrl) {
      continue;
    }
    usageCounts.set(proxyUrl, (usageCounts.get(proxyUrl) ?? 0) + 1);
  }

  return enabledProxies
    .filter((proxy) => proxy.url.trim() && allowedProxyIds.has(proxy.id))
    .map((proxy) => ({
      id: proxy.id,
      url: proxy.url,
      maxAuthFiles: proxy.maxAuthFiles,
      currentAuthFiles: usageCounts.get(proxy.url) ?? 0,
    }))
    .filter((proxy) => proxy.currentAuthFiles < proxy.maxAuthFiles);
}

function authRawJsonWithProxyUrl(rawJson: string | null, proxyUrl: string) {
  let payload: Record<string, unknown> = {};
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
  }

  payload.proxy_url = proxyUrl;
  return JSON.stringify(payload);
}

async function syncAffectedCpaInstance(cpaInstanceId: number) {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error" as const,
      message: errorMessage(error),
    };
  }
}

function okWithOptionalSync(result: {
  action: BatchAction;
  processed: number;
  skipped?: number;
  sync: CpaInstanceSyncResult;
}) {
  return ok(
    result.sync.status === "error"
      ? {
          status: "ok",
          action: result.action,
          processed: result.processed,
          skipped: result.skipped,
          sync: result.sync,
        }
      : {
          status: "ok",
          action: result.action,
          processed: result.processed,
          skipped: result.skipped,
        },
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
