import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { cpaInstances, quotaSnapshots } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const groups = instances.map((instance) => {
      const rows = db
        .select()
        .from(quotaSnapshots)
        .where(eq(quotaSnapshots.cpaInstanceId, instance.id))
        .orderBy(desc(quotaSnapshots.capturedAt))
        .limit(300)
        .all();

      return {
        instance,
        quotas: latestByAccount(rows).map((row) => ({
          ...row,
          subscriptionType: extractSubscriptionType(row.rawJson),
        })),
      };
    });

    return ok({ groups });
  } catch (error) {
    return serverError(error);
  }
}

function latestByAccount<T extends { email: string | null; authFileName: string | null }>(rows: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const key = row.email || row.authFileName;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }

  return result;
}

function extractSubscriptionType(rawJson: string | null) {
  if (!rawJson) {
    return null;
  }

  try {
    const payload = JSON.parse(rawJson) as unknown;
    if (!isRecord(payload)) {
      return null;
    }

    return (
      firstString(payload, ["plan_type", "planType", "subscription_type", "subscriptionType"]) ??
      (isRecord(payload.rate_limit)
        ? firstString(payload.rate_limit, ["plan_type", "planType"])
        : null) ??
      null
    );
  } catch {
    return null;
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
