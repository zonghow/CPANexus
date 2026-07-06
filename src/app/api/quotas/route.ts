import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { cpaInstances, quotaSnapshots } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { resolveAccountQuotaStatus } from "@/lib/account-quota-status";
import { extractQuotaResetTimes } from "@/lib/quota-reset";
import { extractSubscriptionType } from "@/lib/subscription";

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
        .limit(2000)
        .all();

      return {
        instance,
        quotas: latestByAccount(rows).map((row) => {
          const quotaStatus = resolveAccountQuotaStatus({
            disabled: false,
            available: row.available,
            exception: row.exception,
            rawJson: row.rawJson,
          });

          // `usage_*` stay null for failed/dead accounts so averages and the
          // data board keep excluding them; fall back to `prev_usage_*` only
          // for display, flagged as stale so the UI marks it as old data.
          const usage5hStale =
            row.usage5hPercent === null && row.prevUsage5hPercent !== null;
          const usageWeekStale =
            row.usageWeekPercent === null && row.prevUsageWeekPercent !== null;

          return {
            ...row,
            subscriptionType: extractSubscriptionType(row.rawJson),
            quotaStatus: quotaStatus.state,
            quotaStatusLabel: quotaStatus.label,
            usage5hPercent: row.usage5hPercent ?? row.prevUsage5hPercent,
            usageWeekPercent: row.usageWeekPercent ?? row.prevUsageWeekPercent,
            usage5hStale,
            usageWeekStale,
            rawJson: null,
            ...extractQuotaResetTimes(row.rawJson, row.capturedAt),
          };
        }),
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
    const key = quotaAccountKey(row);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }

  return result;
}

function quotaAccountKey(row: { email: string | null; authFileName: string | null }) {
  if (row.authFileName) {
    return `file:${row.authFileName}`;
  }
  return row.email ? `email:${row.email.toLowerCase()}` : null;
}
