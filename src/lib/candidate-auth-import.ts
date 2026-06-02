import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  candidateAuthFiles,
  quotaSnapshots,
  type AuthFile,
  type CpaInstance,
} from "@/db/schema";
import {
  deleteRemoteAuthFile,
  downloadRemoteAuthFile,
} from "@/lib/cpa-client";

import { expandCpaAuthJsonFile, type CpaAuthJsonUploadResult } from "./cpa-auth-json";

export type CandidateAuthImportResult = {
  uploaded: number;
  failed: number;
  results: CpaAuthJsonUploadResult[];
};

export function importCandidateAuthFiles(
  files: unknown[],
  options: { now?: Date } = {},
): CandidateAuthImportResult {
  const now = (options.now ?? new Date()).toISOString();
  const results: CpaAuthJsonUploadResult[] = [];

  for (const file of files) {
    const expandedFiles = expandCpaAuthJsonFile(file);
    for (const expanded of expandedFiles) {
      if (expanded.kind === "error") {
        results.push(expanded.result);
        continue;
      }

      const normalized = expanded.file;
      try {
        db.insert(candidateAuthFiles)
          .values({
            fileName: normalized.fileName,
            email: normalized.email,
            provider: normalized.provider,
            available: true,
            status: "待刷新",
            statusMessage: null,
            rawJson: JSON.stringify(normalized.payload),
            quotaRawJson: null,
            usage5hPercent: null,
            usageWeekPercent: null,
            lastQuotaRefreshedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: candidateAuthFiles.fileName,
            set: {
              email: normalized.email,
              provider: normalized.provider,
              available: true,
              status: "待刷新",
              statusMessage: null,
              rawJson: JSON.stringify(normalized.payload),
              quotaRawJson: null,
              usage5hPercent: null,
              usageWeekPercent: null,
              lastQuotaRefreshedAt: null,
              updatedAt: now,
            },
          })
          .run();

        results.push({
          fileName: normalized.fileName,
          email: normalized.email,
          status: "success",
        });
      } catch (error) {
        results.push({
          fileName: normalized.fileName,
          email: normalized.email,
          status: "error",
          error: errorMessage(error),
        });
      }
    }
  }

  const uploaded = results.filter((result) => result.status === "success").length;
  return {
    uploaded,
    failed: results.length - uploaded,
    results,
  };
}

export async function portalAuthFileToCandidatePool(
  instance: CpaInstance,
  authFile: AuthFile,
) {
  const payload = await loadAuthPayloadForPortal(instance, authFile);
  const now = new Date().toISOString();
  const rawJson = stringifyStoredAuthPayload(payload);

  db.insert(candidateAuthFiles)
    .values({
      fileName: authFile.fileName,
      email: authFile.email ?? emailFromPayload(payload),
      provider: authFile.provider ?? providerFromPayload(payload),
      available: true,
      status: "待刷新",
      statusMessage: null,
      rawJson,
      quotaRawJson: null,
      usage5hPercent: null,
      usageWeekPercent: null,
      lastQuotaRefreshedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: candidateAuthFiles.fileName,
      set: {
        email: authFile.email ?? emailFromPayload(payload),
        provider: authFile.provider ?? providerFromPayload(payload),
        available: true,
        status: "待刷新",
        statusMessage: null,
        rawJson,
        quotaRawJson: null,
        usage5hPercent: null,
        usageWeekPercent: null,
        lastQuotaRefreshedAt: null,
        updatedAt: now,
      },
    })
    .run();

  await deleteRemoteAuthFile(instance, authFile.fileName);
  deleteLocalAuthFile(authFile.cpaInstanceId, authFile.id, authFile.fileName);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadAuthPayloadForPortal(instance: CpaInstance, authFile: AuthFile) {
  try {
    return await downloadRemoteAuthFile(instance, authFile.fileName);
  } catch {
    if (!authFile.rawJson) {
      throw new Error("auth file payload is unavailable");
    }
    return parseStoredAuthPayload(authFile.rawJson);
  }
}

function stringifyStoredAuthPayload(payload: unknown) {
  const text = JSON.stringify(payload);
  if (!text) {
    throw new Error("auth file payload is unavailable");
  }
  return text;
}

function parseStoredAuthPayload(rawJson: string) {
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("stored auth payload is invalid");
  }
}

function emailFromPayload(payload: unknown) {
  return isRecord(payload) ? stringOrNull(payload.email) : null;
}

function providerFromPayload(payload: unknown) {
  return isRecord(payload)
    ? stringOrNull(payload.provider) ?? stringOrNull(payload.type)
    : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deleteLocalAuthFile(
  cpaInstanceId: number,
  authFileId: number,
  fileName: string,
) {
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
