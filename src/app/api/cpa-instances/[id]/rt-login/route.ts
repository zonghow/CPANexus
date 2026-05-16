import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, cpaInstances, proxies } from "@/db/schema";
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
import { uploadRemoteAuthFile } from "@/lib/cpa-client";
import { syncCpaInstanceById, type CpaInstanceSyncResult } from "@/lib/jobs";
import {
  buildRtLoginAuth,
  clientIdForRtLoginMode,
  parseRtLoginLines,
  refreshOpenAiToken,
  type RtLoginAuthResult,
  type RtLoginMode,
} from "@/lib/rt-login";

export const runtime = "nodejs";

type RtLoginAction = "login" | "upload";

type RtLoginBody = {
  action?: RtLoginAction;
  mode?: RtLoginMode;
  line?: string;
  entries?: RtLoginAuthResult[];
  proxyId?: unknown;
};

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

    const instance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, cpaInstanceId))
      .get();
    if (!instance) {
      return notFound("CPA instance not found");
    }

    const body = await readJson<RtLoginBody>(request);
    const mode = normalizeRtLoginMode(body.mode);
    if (!mode) {
      return badRequest("mode must be rt or mobile_rt");
    }

    if (body.action === "login") {
      const line = body.line?.trim();
      if (!line) {
        return badRequest("line is required");
      }

      const parsed = parseRtLoginLines(line);
      if (parsed.invalid.length > 0 || parsed.valid.length !== 1) {
        return badRequest("invalid RT line");
      }

      const proxyId = normalizeOptionalPositiveInteger(body.proxyId);
      if (proxyId === false) {
        return badRequest("proxyId must be a positive integer");
      }

      const proxyUrl = proxyId ? enabledProxyUrl(proxyId) : undefined;
      if (proxyId && !proxyUrl) {
        return badRequest("代理不可用或未启用");
      }

      const clientId = clientIdForRtLoginMode(mode);
      const tokenResponse = await refreshOpenAiToken(parsed.valid[0].refreshToken, {
        clientId,
        proxyUrl: proxyUrl ?? undefined,
      });
      return ok(buildRtLoginAuth(parsed.valid[0], tokenResponse, { clientId }));
    }

    if (body.action === "upload") {
      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (entries.length === 0) {
        return badRequest("entries is required");
      }

      const results = [];
      for (const entry of entries) {
        const normalized = normalizeUploadEntry(entry);
        if (!normalized) {
          results.push({
            email: entry?.email ?? null,
            fileName: entry?.fileName ?? null,
            status: "error",
            error: "invalid uploaded entry",
          });
          continue;
        }

        try {
          await uploadRemoteAuthFile(instance, normalized.fileName, normalized.payload);
          upsertLocalAuthFile(instance.id, normalized);
          results.push({
            email: normalized.email,
            fileName: normalized.fileName,
            status: "success",
          });
        } catch (error) {
          const message = errorMessage(error);
          results.push({
            email: normalized.email,
            fileName: normalized.fileName,
            status: "error",
            error: message,
          });
        }
      }

      const uploaded = results.filter((result) => result.status === "success").length;
      const sync = uploaded > 0 ? await syncAffectedCpaInstance(instance.id) : null;
      return ok({
        uploaded,
        failed: results.length - uploaded,
        results,
        sync,
      });
    }

    return badRequest("action must be login or upload");
  } catch (error) {
    return serverError(error);
  }
}

function normalizeRtLoginMode(value: unknown): RtLoginMode | null {
  return value === "rt" || value === "mobile_rt" ? value : null;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null | false {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : false;
}

function enabledProxyUrl(proxyId: number): string | null {
  const proxy = db
    .select({ url: proxies.url })
    .from(proxies)
    .where(and(eq(proxies.id, proxyId), eq(proxies.enabled, true)))
    .get();
  return proxy?.url.trim() || null;
}

function normalizeUploadEntry(value: unknown): RtLoginAuthResult | null {
  if (!isRecord(value)) {
    return null;
  }
  const email = stringOrNull(value.email);
  const fileName = stringOrNull(value.fileName);
  const planType = stringOrNull(value.planType) ?? "unknown";
  const refreshToken = stringOrNull(value.refreshToken);
  const sourceLine = stringOrNull(value.sourceLine) ?? "";
  const payload = value.payload;
  if (!email || !fileName || !refreshToken || !isRecord(payload)) {
    return null;
  }

  return {
    email,
    fileName,
    planType,
    payload,
    refreshToken,
    sourceLine,
  };
}

function upsertLocalAuthFile(
  cpaInstanceId: number,
  entry: RtLoginAuthResult,
) {
  const savedAt = nowIso();
  db.insert(authFiles)
    .values({
      cpaInstanceId,
      fileName: entry.fileName,
      email: entry.email,
      provider: "codex",
      status: "uploaded",
      statusMessage: "uploaded by CPA Nexus RT login",
      available: true,
      rawJson: JSON.stringify(entry.payload),
      lastSyncedAt: savedAt,
    })
    .onConflictDoUpdate({
      target: [authFiles.cpaInstanceId, authFiles.fileName],
      set: {
        email: entry.email,
        provider: "codex",
        status: "uploaded",
        statusMessage: "uploaded by CPA Nexus RT login",
        available: true,
        rawJson: JSON.stringify(entry.payload),
        lastSyncedAt: savedAt,
      },
    })
    .run();
}

async function syncAffectedCpaInstance(cpaInstanceId: number): Promise<CpaInstanceSyncResult> {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error",
      message: errorMessage(error),
    };
  }
}

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
