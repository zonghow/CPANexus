import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { candidateAuthFiles } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { refreshCandidateAuthFileQuota } from "@/lib/candidate-pool-quota";

export const runtime = "nodejs";

const quotaRefreshConcurrency = 4;

type CandidateQuotaRefreshBody = {
  refreshToken?: unknown;
};

type CandidateQuotaRefreshItem = {
  id: number;
  fileName: string;
  email: string | null;
  status: "success" | "error";
  message: string | null;
};

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readOptionalJson<CandidateQuotaRefreshBody>(request);
    const refreshAccessToken = body.refreshToken !== false;
    const rows = db.select().from(candidateAuthFiles).orderBy(candidateAuthFiles.fileName).all();
    const results = await mapWithConcurrency(rows, quotaRefreshConcurrency, async (row) => {
      const now = new Date().toISOString();
      try {
        const result = await refreshCandidateAuthFileQuota(
          {
            fileName: row.fileName,
            email: row.email,
            rawJson: row.rawJson,
          },
          { refreshAccessToken },
        );
        const status = quotaStatusFromSnapshot(result.snapshot.available, result.snapshot.exception);
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
            lastQuotaRefreshedAt: now,
            updatedAt: now,
          })
          .where(eqCandidateId(row.id))
          .run();

        return {
          id: row.id,
          fileName: row.fileName,
          email,
          status: result.snapshot.exception ? "error" : "success",
          message: result.snapshot.exception,
        } satisfies CandidateQuotaRefreshItem;
      } catch (error) {
        const message = errorMessage(error);
        db.update(candidateAuthFiles)
          .set({
            available: false,
            status: "异常",
            statusMessage: message,
            lastQuotaRefreshedAt: now,
            updatedAt: now,
          })
          .where(eqCandidateId(row.id))
          .run();

        return {
          id: row.id,
          fileName: row.fileName,
          email: row.email,
          status: "error",
          message,
        } satisfies CandidateQuotaRefreshItem;
      }
    });

    const failed = results.filter((result) => result.status === "error").length;
    return ok({
      refreshed: results.length - failed,
      failed,
      results,
    });
  } catch (error) {
    return serverError(error);
  }
}

async function readOptionalJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function quotaStatusFromSnapshot(available: boolean, exception: string | null) {
  if (exception) {
    return "异常";
  }
  return available ? "可用" : "限额";
}

function eqCandidateId(id: number) {
  return eq(candidateAuthFiles.id, id);
}

function emailFromAuthJson(authJson: Record<string, unknown>) {
  return stringOrNull(authJson.email);
}

function providerFromAuthJson(authJson: Record<string, unknown>) {
  return stringOrNull(authJson.provider) ?? stringOrNull(authJson.type);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
