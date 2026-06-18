import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { accountTags, authFiles, cpaInstances, proxies, proxyCpaInstances, quotaSnapshots } from "@/db/schema";
import { accountTagKey, normalizeAccountTag } from "@/lib/account-tags";
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
  downloadRemoteAuthFile,
  patchRemoteAuthFileFields,
  setRemoteAuthFileDisabled,
  uploadRemoteAuthFile,
} from "@/lib/cpa-client";
import {
  syncCpaInstanceById,
  type CpaInstanceSyncResult,
} from "@/lib/jobs";
import { portalAuthFileToCandidatePool } from "@/lib/candidate-auth-import";
import { portalAuthFileToExceptionPool } from "@/lib/exception-auth-files";
import { extractSubscriptionType, isFreeSubscriptionType } from "@/lib/subscription";
import { buildZipArchive } from "@/lib/zip";

export const runtime = "nodejs";

type BatchAction =
  | "delete"
  | "disable"
  | "autoAssignProxy"
  | "download"
  | "move"
  | "tag"
  | "portalExceptions"
  | "portalCandidates";
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

    const body = await readJson<{
      action?: BatchAction;
      authFileIds?: number[];
      target?: BatchTarget;
      targetCpaInstanceId?: number;
      tag?: string;
    }>(request);
    if (
      body.action !== "delete" &&
      body.action !== "disable" &&
      body.action !== "autoAssignProxy" &&
      body.action !== "download" &&
      body.action !== "move" &&
      body.action !== "tag" &&
      body.action !== "portalExceptions" &&
      body.action !== "portalCandidates"
    ) {
      return badRequest("action must be delete, disable, autoAssignProxy, download, move, tag, portalExceptions, or portalCandidates");
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

    if (body.action === "download") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      const archive = await downloadAuthFilesAsZip(instance, rows);
      for (const authFile of rows) {
        await deleteRemoteAuthFile(instance, authFile.fileName);
        deleteLocalAuthFile(cpaInstanceId, authFile.id, authFile.fileName);
      }
      await syncAffectedCpaInstance(cpaInstanceId);

      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${downloadZipFileName()}"`,
        },
      });
    }

    if (body.action === "move") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      const targetInstance = loadTargetCpaInstance(cpaInstanceId, body.targetCpaInstanceId);
      if (targetInstance instanceof Response) {
        return targetInstance;
      }

      const duplicateFileName = firstDuplicateTargetFileName(targetInstance.id, rows);
      if (duplicateFileName) {
        return badRequest(`target CPA already has auth file ${duplicateFileName}`);
      }

      const movedAt = new Date().toISOString();
      for (const authFile of rows) {
        const payload = await loadAuthPayload(instance, authFile.fileName, authFile.rawJson);
        await uploadRemoteAuthFile(targetInstance, authFile.fileName, payload);
        await deleteRemoteAuthFile(instance, authFile.fileName);
        moveLocalAuthFile(targetInstance.id, authFile.id, authFile.cpaInstanceId, authFile.fileName, movedAt);
      }

      return okWithOptionalSync({
        action: body.action,
        processed: rows.length,
        sync: await syncAffectedCpaInstances([cpaInstanceId, targetInstance.id]),
      });
    }

    if (body.action === "tag") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      const tag = normalizeAccountTag(body.tag);
      if (!tag) {
        return badRequest("tag is required");
      }

      upsertAccountTags(rows, tag);

      return ok({
        status: "ok",
        action: body.action,
        processed: rows.length,
      });
    }

    if (body.action === "portalExceptions") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      for (const authFile of rows) {
        await portalAuthFileToExceptionPool(instance, authFile);
      }

      return okWithOptionalSync({
        action: body.action,
        processed: rows.length,
        sync: await syncAffectedCpaInstance(cpaInstanceId),
      });
    }

    if (body.action === "portalCandidates") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      for (const authFile of rows) {
        await portalAuthFileToCandidatePool(instance, authFile);
      }

      return okWithOptionalSync({
        action: body.action,
        processed: rows.length,
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

function upsertAccountTags(
  rows: Array<typeof authFiles.$inferSelect>,
  tag: string,
) {
  const taggedAt = new Date().toISOString();

  for (const authFile of rows) {
    db.insert(accountTags)
      .values({
        accountKey: accountTagKey(authFile),
        tag,
        createdAt: taggedAt,
        updatedAt: taggedAt,
      })
      .onConflictDoUpdate({
        target: accountTags.accountKey,
        set: {
          tag,
          updatedAt: taggedAt,
        },
      })
      .run();
  }
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

async function downloadAuthFilesAsZip(
  instance: typeof cpaInstances.$inferSelect,
  rows: Array<typeof authFiles.$inferSelect>,
) {
  const entries = [];
  for (const authFile of rows) {
    const payload = await loadAuthPayload(instance, authFile.fileName, authFile.rawJson);
    entries.push({
      name: authFile.fileName,
      data: stringifyAuthPayload(payload),
    });
  }

  return buildZipArchive(entries);
}

async function loadAuthPayload(
  sourceInstance: Parameters<typeof downloadRemoteAuthFile>[0],
  fileName: string,
  rawJson: string | null,
) {
  try {
    return await downloadRemoteAuthFile(sourceInstance, fileName);
  } catch {
    if (!rawJson) {
      throw new Error("auth file payload is unavailable");
    }
    return JSON.parse(rawJson) as unknown;
  }
}

function stringifyAuthPayload(payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  if (!text) {
    throw new Error("auth file payload is unavailable");
  }
  return `${text}\n`;
}

function loadTargetCpaInstance(sourceCpaInstanceId: number, targetCpaInstanceId: number | undefined) {
  if (!targetCpaInstanceId || targetCpaInstanceId === sourceCpaInstanceId) {
    return badRequest("target CPA instance is required");
  }

  const targetInstance = db
    .select()
    .from(cpaInstances)
    .where(eq(cpaInstances.id, targetCpaInstanceId))
    .get();
  if (!targetInstance) {
    return notFound("target CPA instance not found");
  }
  if (!targetInstance.enabled) {
    return badRequest("target CPA instance is disabled");
  }

  return targetInstance;
}

function firstDuplicateTargetFileName(
  targetCpaInstanceId: number,
  rows: Array<typeof authFiles.$inferSelect>,
) {
  const targetFileNames = new Set(
    db
      .select({ fileName: authFiles.fileName })
      .from(authFiles)
      .where(eq(authFiles.cpaInstanceId, targetCpaInstanceId))
      .all()
      .map((row) => row.fileName),
  );

  return rows.find((row) => targetFileNames.has(row.fileName))?.fileName ?? null;
}

function moveLocalAuthFile(
  targetCpaInstanceId: number,
  authFileId: number,
  sourceCpaInstanceId: number,
  fileName: string,
  movedAt: string,
) {
  db.delete(quotaSnapshots)
    .where(
      and(
        eq(quotaSnapshots.cpaInstanceId, sourceCpaInstanceId),
        eq(quotaSnapshots.authFileName, fileName),
      ),
    )
    .run();
  db.update(authFiles)
    .set({
      cpaInstanceId: targetCpaInstanceId,
      status: "待配额刷新",
      statusMessage: "已移动，等待目标 CPA 配额刷新",
      available: false,
      lastSyncedAt: movedAt,
    })
    .where(eq(authFiles.id, authFileId))
    .run();
}

function downloadZipFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `auths-${year}${month}${day}-${hour}${minute}${second}.zip`;
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
    const proxy = selectLeastUsedProxyCandidate(candidates);
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

function selectLeastUsedProxyCandidate(
  candidates: Array<{
    id: number;
    url: string;
    maxAuthFiles: number;
    currentAuthFiles: number;
  }>,
) {
  return candidates
    .filter((candidate) => candidate.currentAuthFiles < candidate.maxAuthFiles)
    .sort((left, right) =>
      left.currentAuthFiles - right.currentAuthFiles ||
      left.id - right.id
    )[0] ?? null;
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

async function syncAffectedCpaInstances(cpaInstanceIds: number[]) {
  const results = [];
  for (const cpaInstanceId of [...new Set(cpaInstanceIds)]) {
    results.push(await syncAffectedCpaInstance(cpaInstanceId));
  }

  const failed = results.filter((result) => result.status === "error");
  if (failed.length === 0) {
    return {
      instance: `${results.length} 个 CPA`,
      status: "success" as const,
      message: "synced",
    };
  }
  if (failed.length === 1) {
    return failed[0];
  }

  return {
    instance: `${failed.length} 个 CPA`,
    status: "error" as const,
    message: failed.map((result) => `${result.instance}: ${result.message}`).join("; "),
  };
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
