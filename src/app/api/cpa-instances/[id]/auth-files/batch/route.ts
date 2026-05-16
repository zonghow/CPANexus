import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, cpaInstances, proxies, proxyCpaInstances, quotaSnapshots } from "@/db/schema";
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
import { extractSubscriptionType, isFreeSubscriptionType } from "@/lib/subscription";

export const runtime = "nodejs";

type BatchAction = "delete" | "disable" | "autoAssignProxy";
type BatchTarget = "selected" | "free";

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

    const body = await readJson<{ action?: BatchAction; authFileIds?: number[]; target?: BatchTarget }>(request);
    if (body.action !== "delete" && body.action !== "disable" && body.action !== "autoAssignProxy") {
      return badRequest("action must be delete, disable, or autoAssignProxy");
    }
    if (body.target !== undefined && body.target !== "selected" && body.target !== "free") {
      return badRequest("target must be selected or free");
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

    const target = body.target ?? "selected";
    const rows =
      target === "free"
        ? loadFreeAuthFiles(cpaInstanceId, body.action === "delete")
        : loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
    if (rows instanceof Response) {
      return rows;
    }

    const updatedAt = new Date().toISOString();
    for (const authFile of rows) {
      if (body.action === "delete") {
        await deleteRemoteAuthFile(instance, authFile.fileName);
        deleteLocalAuthFile(cpaInstanceId, authFile.id, authFile.fileName);
      } else {
        await setRemoteAuthFileDisabled(instance, authFile.fileName, true);
        db.update(authFiles)
          .set({
            disabled: true,
            available: false,
            status: "已停用",
            statusMessage: target === "free" ? "批量停用Free号" : "批量停用异常账号",
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

function loadSelectedAuthFiles(cpaInstanceId: number, authFileIds: number[] | undefined) {
  const selectedIds = Array.isArray(authFileIds)
    ? [...new Set(authFileIds.filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  if (selectedIds.length === 0) {
    return badRequest("authFileIds is required");
  }

  const rows = db
    .select()
    .from(authFiles)
    .where(and(eq(authFiles.cpaInstanceId, cpaInstanceId), inArray(authFiles.id, selectedIds)))
    .orderBy(authFiles.id)
    .all();
  if (rows.length !== selectedIds.length) {
    return badRequest("some auth files do not belong to this CPA instance");
  }

  return rows;
}

function loadFreeAuthFiles(cpaInstanceId: number, includeDisabled: boolean) {
  const rows = db
    .select()
    .from(authFiles)
    .where(eq(authFiles.cpaInstanceId, cpaInstanceId))
    .orderBy(authFiles.id)
    .all();
  if (rows.length === 0) {
    return rows;
  }

  const quotaByFileName = new Map<string, typeof quotaSnapshots.$inferSelect>();
  const quotaByEmail = new Map<string, typeof quotaSnapshots.$inferSelect>();
  const quotaRows = db
    .select()
    .from(quotaSnapshots)
    .where(eq(quotaSnapshots.cpaInstanceId, cpaInstanceId))
    .orderBy(desc(quotaSnapshots.capturedAt), desc(quotaSnapshots.id))
    .all();
  for (const quota of quotaRows) {
    if (quota.authFileName && !quotaByFileName.has(quota.authFileName)) {
      quotaByFileName.set(quota.authFileName, quota);
    }
    if (quota.email) {
      const email = quota.email.toLowerCase();
      if (!quotaByEmail.has(email)) {
        quotaByEmail.set(email, quota);
      }
    }
  }

  return rows.filter((authFile) => {
    if (!includeDisabled && authFile.disabled) {
      return false;
    }
    const quota =
      quotaByFileName.get(authFile.fileName) ??
      (authFile.email ? quotaByEmail.get(authFile.email.toLowerCase()) : undefined);
    return isFreeSubscriptionType(extractSubscriptionType(quota?.rawJson ?? null));
  });
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
