import { and, eq } from "drizzle-orm";

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
import { portalAuthFileToCandidatePool } from "@/lib/candidate-auth-import";
import { portalAuthFileToExceptionPool } from "@/lib/exception-auth-files";
import {
  refreshAuthFileQuotaById,
  syncCpaInstanceById,
  type CpaInstanceSyncResult,
} from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    const body = await readJson<{ action?: string }>(request);
    if (
      body.action !== "refreshQuota" &&
      body.action !== "portalException" &&
      body.action !== "portalCandidate"
    ) {
      return badRequest("action must be refreshQuota, portalException, or portalCandidate");
    }

    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    if (body.action === "portalException") {
      initRequestDb();
      const authFile = db.select().from(authFiles).where(eq(authFiles.id, id)).get();
      if (!authFile) {
        return notFound("auth file not found");
      }
      const sourceInstance = db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, authFile.cpaInstanceId))
        .get();
      if (!sourceInstance) {
        return notFound("CPA instance not found");
      }

      await portalAuthFileToExceptionPool(sourceInstance, authFile);
      return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
    }

    if (body.action === "portalCandidate") {
      initRequestDb();
      const authFile = db.select().from(authFiles).where(eq(authFiles.id, id)).get();
      if (!authFile) {
        return notFound("auth file not found");
      }
      const sourceInstance = db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, authFile.cpaInstanceId))
        .get();
      if (!sourceInstance) {
        return notFound("CPA instance not found");
      }

      await portalAuthFileToCandidatePool(sourceInstance, authFile);
      return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
    }

    return ok(await refreshAuthFileQuotaById(id));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const authFile = getAuthFileFromContext(await routeParams(context));
    if (!authFile) {
      return notFound("auth file not found");
    }

    const sourceInstance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, authFile.cpaInstanceId))
      .get();
    if (!sourceInstance) {
      return notFound("CPA instance not found");
    }

    await deleteRemoteAuthFile(sourceInstance, authFile.fileName);
    deleteLocalAuthFile(authFile.cpaInstanceId, authFile.id, authFile.fileName);

    return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const authFile = getAuthFileFromContext(await routeParams(context));
    if (!authFile) {
      return notFound("auth file not found");
    }

    const body = await readJson<{
      targetCpaInstanceId?: number;
      disabled?: boolean;
      proxyUrl?: string | null;
      tag?: string;
    }>(request);

    if (Object.hasOwn(body, "tag")) {
      const tag = normalizeAccountTag(body.tag);
      if (!tag) {
        return badRequest("tag is required");
      }

      const taggedAt = new Date().toISOString();
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

      return ok({ status: "ok", tag });
    }

    if (Object.hasOwn(body, "proxyUrl")) {
      const sourceInstance = db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, authFile.cpaInstanceId))
        .get();
      if (!sourceInstance) {
        return notFound("CPA instance not found");
      }

      const proxyUrl = typeof body.proxyUrl === "string" && body.proxyUrl.trim()
        ? body.proxyUrl.trim()
        : null;

      if (proxyUrl) {
        const proxy = db
          .select()
          .from(proxies)
          .where(and(eq(proxies.url, proxyUrl), eq(proxies.enabled, true)))
          .get();
        if (!proxy) {
          return badRequest("proxy is unavailable");
        }

        const link = db
          .select()
          .from(proxyCpaInstances)
          .where(
            and(
              eq(proxyCpaInstances.proxyId, proxy.id),
              eq(proxyCpaInstances.cpaInstanceId, authFile.cpaInstanceId),
            ),
          )
          .get();
        if (!link) {
          return badRequest("proxy is not allowed for this CPA instance");
        }
      }

      await patchRemoteAuthFileFields(sourceInstance, authFile.fileName, {
        proxy_url: proxyUrl ?? "",
      });

      db.update(authFiles)
        .set({
          proxyUrl,
          rawJson: authRawJsonWithProxyUrl(authFile.rawJson, proxyUrl),
          lastSyncedAt: new Date().toISOString(),
        })
        .where(eq(authFiles.id, authFile.id))
        .run();

      return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
    }

    if (typeof body.disabled === "boolean") {
      const sourceInstance = db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, authFile.cpaInstanceId))
        .get();
      if (!sourceInstance) {
        return notFound("CPA instance not found");
      }

      await setRemoteAuthFileDisabled(sourceInstance, authFile.fileName, body.disabled);

      const updatedAt = new Date().toISOString();
      db.update(authFiles)
        .set({
          disabled: body.disabled,
          available: false,
          status: body.disabled ? "已停用" : "待配额刷新",
          statusMessage: body.disabled ? "手动停用" : "已启用，等待配额刷新",
          lastSyncedAt: updatedAt,
        })
        .where(eq(authFiles.id, authFile.id))
        .run();

      return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
    }

    if (!body.targetCpaInstanceId || body.targetCpaInstanceId === authFile.cpaInstanceId) {
      return badRequest("target CPA instance is required");
    }

    const sourceInstance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, authFile.cpaInstanceId))
      .get();
    const targetInstance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, body.targetCpaInstanceId))
      .get();
    if (!sourceInstance || !targetInstance) {
      return notFound("CPA instance not found");
    }
    if (!targetInstance.enabled) {
      return badRequest("target CPA instance is disabled");
    }

    const targetExisting = db
      .select()
      .from(authFiles)
      .where(
        and(
          eq(authFiles.cpaInstanceId, targetInstance.id),
          eq(authFiles.fileName, authFile.fileName),
        ),
      )
      .get();
    if (targetExisting) {
      return badRequest("target CPA already has this auth file");
    }

    const payload = await loadAuthPayload(sourceInstance, authFile.fileName, authFile.rawJson);
    await uploadRemoteAuthFile(targetInstance, authFile.fileName, payload);
    await deleteRemoteAuthFile(sourceInstance, authFile.fileName);

    const movedAt = new Date().toISOString();
    db.delete(quotaSnapshots)
      .where(
        and(
          eq(quotaSnapshots.cpaInstanceId, authFile.cpaInstanceId),
          eq(quotaSnapshots.authFileName, authFile.fileName),
        ),
      )
      .run();
    db.update(authFiles)
      .set({
        cpaInstanceId: targetInstance.id,
        status: "待配额刷新",
        statusMessage: "已移动，等待目标 CPA 配额刷新",
        available: false,
        lastSyncedAt: movedAt,
      })
      .where(eq(authFiles.id, authFile.id))
      .run();

    return okWithOptionalSync(
      await syncAffectedCpaInstances([sourceInstance.id, targetInstance.id]),
    );
  } catch (error) {
    return serverError(error);
  }
}

function getAuthFileFromContext(params: { id: string }) {
  const id = parseIntegerId(params.id);
  if (!id) {
    return null;
  }

  return db.select().from(authFiles).where(eq(authFiles.id, id)).get() ?? null;
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

type SyncFailureResponse =
  | CpaInstanceSyncResult
  | {
      status: "error";
      message: string;
      details: CpaInstanceSyncResult[];
    };

async function syncAffectedCpaInstances(cpaInstanceIds: number[]) {
  const uniqueIds = [...new Set(cpaInstanceIds)];
  const results: CpaInstanceSyncResult[] = [];

  for (const cpaInstanceId of uniqueIds) {
    try {
      results.push(await syncCpaInstanceById(cpaInstanceId));
    } catch (error) {
      results.push({
        instance: `CPA #${cpaInstanceId}`,
        status: "error",
        message: errorMessage(error),
      });
    }
  }

  const failed = results.filter((result) => result.status === "error");
  if (failed.length === 0) {
    return null;
  }
  if (failed.length === 1) {
    return failed[0];
  }

  return {
    status: "error" as const,
    message: `${failed.length} 个 CPA 同步失败`,
    details: failed,
  };
}

function okWithOptionalSync(sync: SyncFailureResponse | null) {
  return ok(sync ? { status: "ok", sync } : { status: "ok" });
}

function authRawJsonWithProxyUrl(rawJson: string | null, proxyUrl: string | null) {
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

  if (proxyUrl) {
    payload.proxy_url = proxyUrl;
  } else {
    delete payload.proxy_url;
  }

  return JSON.stringify(payload);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
