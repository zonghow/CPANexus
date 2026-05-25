import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { candidateAuthFiles, cpaInstances } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  readJson,
  requireAuth,
  serverError,
} from "@/lib/api";
import { uploadRemoteAuthFile } from "@/lib/cpa-client";
import {
  refreshCandidateAuthFileQuota,
  refreshCandidateAuthFileToken,
} from "@/lib/candidate-pool-quota";
import { syncCpaInstanceById } from "@/lib/jobs";
import { buildZipArchive } from "@/lib/zip";

export const runtime = "nodejs";

type CandidateBatchAction =
  | "export"
  | "exportAndDelete"
  | "move"
  | "refreshToken"
  | "refreshQuota";

type CandidateBatchBody = {
  action?: CandidateBatchAction;
  authFileIds?: unknown;
  refreshToken?: unknown;
  targetCpaInstanceId?: unknown;
};

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readJson<CandidateBatchBody>(request);
    if (
      body.action !== "export" &&
      body.action !== "exportAndDelete" &&
      body.action !== "move" &&
      body.action !== "refreshToken" &&
      body.action !== "refreshQuota"
    ) {
      return badRequest("action must be export, exportAndDelete, move, refreshToken, or refreshQuota");
    }

    const rows = loadSelectedCandidateAuthFiles(body.authFileIds);
    if (rows instanceof Response) {
      return rows;
    }

    if (body.action === "export" || body.action === "exportAndDelete") {
      const archive = buildCandidateZip(rows);
      if (body.action === "exportAndDelete") {
        deleteCandidateAuthFiles(rows.map((row) => row.id));
      }

      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${candidateZipFileName()}"`,
        },
      });
    }

    if (body.action === "refreshToken") {
      const refreshedAt = new Date().toISOString();
      const results = [];
      for (const row of rows) {
        try {
          const result = await refreshCandidateAuthFileToken({
            fileName: row.fileName,
            email: row.email,
            rawJson: row.rawJson,
          });
          db.update(candidateAuthFiles)
            .set({
              email: result.email ?? row.email,
              provider: providerFromAuthJson(result.authJson) ?? row.provider,
              rawJson: JSON.stringify(result.authJson),
              ...(isRtRefreshStatus(row.status, row.statusMessage)
                ? { status: null, statusMessage: null }
                : {}),
              updatedAt: refreshedAt,
            })
            .where(eq(candidateAuthFiles.id, row.id))
            .run();
          results.push({
            id: row.id,
            fileName: row.fileName,
            email: result.email ?? row.email,
            status: "success" as const,
            refreshTokenRotated: result.refreshTokenRotated,
          });
        } catch (error) {
          db.update(candidateAuthFiles)
            .set({
              status: "刷新RT失败",
              statusMessage: errorMessage(error),
              updatedAt: refreshedAt,
            })
            .where(eq(candidateAuthFiles.id, row.id))
            .run();
          results.push({
            id: row.id,
            fileName: row.fileName,
            email: row.email,
            status: "error" as const,
            error: errorMessage(error),
          });
        }
      }

      const failed = results.filter((result) => result.status === "error").length;
      const rotated = results.filter(
        (result) => result.status === "success" && result.refreshTokenRotated,
      ).length;
      return ok({
        status: failed > 0 ? "partial" : "ok",
        action: body.action,
        processed: results.length - failed,
        failed,
        rotated,
        results,
      });
    }

    if (body.action === "refreshQuota") {
      const refreshedAt = new Date().toISOString();
      const refreshAccessToken = body.refreshToken !== false;
      const results = [];
      for (const row of rows) {
        try {
          const result = await refreshCandidateAuthFileQuota(
            {
              fileName: row.fileName,
              email: row.email,
              rawJson: row.rawJson,
            },
            { refreshAccessToken },
          );
          const status = quotaStatusFromSnapshot(
            result.snapshot.available,
            result.snapshot.exception,
          );
          const email = result.snapshot.email ?? row.email ?? emailFromAuthJson(result.authJson);
          db.update(candidateAuthFiles)
            .set({
              email,
              provider: providerFromAuthJson(result.authJson) ?? row.provider,
              available: result.snapshot.available,
              status,
              statusMessage: result.snapshot.exception,
              rawJson: JSON.stringify(result.authJson),
              quotaRawJson: JSON.stringify(result.snapshot.raw ?? {}),
              usage5hPercent: result.snapshot.usage5hPercent,
              usageWeekPercent: result.snapshot.usageWeekPercent,
              lastQuotaRefreshedAt: refreshedAt,
              updatedAt: refreshedAt,
            })
            .where(eq(candidateAuthFiles.id, row.id))
            .run();
          results.push({
            id: row.id,
            fileName: row.fileName,
            email,
            status: result.snapshot.exception ? "error" as const : "success" as const,
            message: result.snapshot.exception,
          });
        } catch (error) {
          const message = errorMessage(error);
          db.update(candidateAuthFiles)
            .set({
              available: false,
              status: "异常",
              statusMessage: message,
              lastQuotaRefreshedAt: refreshedAt,
              updatedAt: refreshedAt,
            })
            .where(eq(candidateAuthFiles.id, row.id))
            .run();
          results.push({
            id: row.id,
            fileName: row.fileName,
            email: row.email,
            status: "error" as const,
            message,
          });
        }
      }

      const failed = results.filter((result) => result.status === "error").length;
      return ok({
        status: failed > 0 ? "partial" : "ok",
        action: body.action,
        processed: results.length - failed,
        failed,
        results,
      });
    }

    const targetInstance = loadTargetCpaInstance(body.targetCpaInstanceId);
    if (targetInstance instanceof Response) {
      return targetInstance;
    }

    for (const row of rows) {
      await uploadRemoteAuthFile(
        targetInstance,
        row.fileName,
        JSON.parse(row.rawJson) as unknown,
      );
    }
    deleteCandidateAuthFiles(rows.map((row) => row.id));
    const sync = await syncAffectedCpaInstance(targetInstance.id);

    return ok({
      status: "ok",
      action: body.action,
      processed: rows.length,
      sync,
    });
  } catch (error) {
    return serverError(error);
  }
}

function loadSelectedCandidateAuthFiles(rawIds: unknown) {
  const selectedIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((id): id is number => Number.isInteger(id) && id > 0))]
    : [];
  if (selectedIds.length === 0) {
    return badRequest("authFileIds is required");
  }

  const rows = db
    .select()
    .from(candidateAuthFiles)
    .where(inArray(candidateAuthFiles.id, selectedIds))
    .orderBy(candidateAuthFiles.id)
    .all();
  if (rows.length !== selectedIds.length) {
    return badRequest("some candidate auth files do not exist");
  }

  return rows;
}

function buildCandidateZip(rows: Array<typeof candidateAuthFiles.$inferSelect>) {
  return buildZipArchive(
    rows.map((row) => ({
      name: row.fileName,
      data: `${JSON.stringify(JSON.parse(row.rawJson) as unknown, null, 2)}\n`,
    })),
  );
}

function deleteCandidateAuthFiles(ids: number[]) {
  if (ids.length === 0) {
    return;
  }

  db.delete(candidateAuthFiles)
    .where(inArray(candidateAuthFiles.id, ids))
    .run();
}

function loadTargetCpaInstance(rawId: unknown) {
  const targetCpaInstanceId = Number(rawId);
  if (!Number.isInteger(targetCpaInstanceId) || targetCpaInstanceId <= 0) {
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

function providerFromAuthJson(authJson: Record<string, unknown>) {
  return stringOrNull(authJson.provider) ?? stringOrNull(authJson.type);
}

function emailFromAuthJson(authJson: Record<string, unknown>) {
  return stringOrNull(authJson.email);
}

function quotaStatusFromSnapshot(available: boolean, exception: string | null) {
  if (exception) {
    return "异常";
  }
  return available ? "可用" : "限额";
}

function isRtRefreshStatus(status: string | null, statusMessage: string | null) {
  return (
    status === "已刷新RT" ||
    status === "刷新RT失败" ||
    statusMessage === "Refresh Token 已轮换" ||
    statusMessage === "Refresh Token 未轮换"
  );
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function syncAffectedCpaInstance(cpaInstanceId: number) {
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

function candidateZipFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `candidate-auths-${year}${month}${day}-${hour}${minute}${second}.zip`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
