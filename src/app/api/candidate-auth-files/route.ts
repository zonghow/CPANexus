import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { candidateAuthFiles } from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";
import { importCandidateAuthFiles } from "@/lib/candidate-auth-import";
import { resolveAccountQuotaStatus } from "@/lib/account-quota-status";
import { extractQuotaResetTimes } from "@/lib/quota-reset";
import { extractSubscriptionType } from "@/lib/subscription";

export const runtime = "nodejs";

type CandidateAuthFilesUploadBody = {
  files?: unknown;
};

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const rows = db
      .select()
      .from(candidateAuthFiles)
      .orderBy(desc(candidateAuthFiles.updatedAt), desc(candidateAuthFiles.id))
      .all();

    return ok({
      authFiles: rows.map((row) => {
        const quotaException = candidateQuotaException(row.statusMessage);
        const quotaStatus = row.lastQuotaRefreshedAt
          ? resolveAccountQuotaStatus({
              disabled: false,
              available: row.available,
              exception: quotaException,
              rawJson: row.quotaRawJson,
            })
          : null;

        return {
          ...row,
          rawJson: null,
          quotaRawJson: null,
          subscriptionType:
            extractSubscriptionType(row.quotaRawJson) ??
            extractSubscriptionType(row.rawJson),
          quotaStatus: quotaStatus?.state ?? null,
          quotaStatusLabel: quotaStatus?.label ?? row.status,
          ...candidateAuthJsonMetadata(row.rawJson),
          ...extractQuotaResetTimes(row.quotaRawJson, row.lastQuotaRefreshedAt),
        };
      }),
    });
  } catch (error) {
    return serverError(error);
  }
}

function candidateQuotaException(statusMessage: string | null) {
  if (
    statusMessage === "Refresh Token 已轮换" ||
    statusMessage === "Refresh Token 未轮换"
  ) {
    return null;
  }
  return statusMessage;
}

function candidateAuthJsonMetadata(rawJson: string | null) {
  if (!rawJson) {
    return { lastRefresh: null, expired: null, refreshToken: null };
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed)) {
      return { lastRefresh: null, expired: null, refreshToken: null };
    }

    return {
      lastRefresh: firstString(parsed, ["last_refresh", "lastRefresh"]),
      expired: firstString(parsed, ["expired", "expires_at", "expiresAt"]),
      refreshToken: firstString(parsed, ["refresh_token", "refreshToken"]),
    };
  } catch {
    return { lastRefresh: null, expired: null, refreshToken: null };
  }
}

function firstString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readJson<CandidateAuthFilesUploadBody>(request);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return badRequest("files is required");
    }

    return ok(importCandidateAuthFiles(files));
  } catch (error) {
    return serverError(error);
  }
}
