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
        .limit(300)
        .all();

      return {
        instance,
        quotas: groupByAccount(rows).map(({ latest, source5h, sourceWeek }) => {
          const quotaStatus = resolveAccountQuotaStatus({
            disabled: false,
            available: latest.available,
            exception: latest.exception,
            rawJson: latest.rawJson,
          });

          const { usage5hResetAt } = extractQuotaResetTimes(
            source5h?.rawJson ?? null,
            source5h?.capturedAt,
          );
          const { usageWeekResetAt } = extractQuotaResetTimes(
            sourceWeek?.rawJson ?? null,
            sourceWeek?.capturedAt,
          );

          return {
            ...latest,
            subscriptionType:
              extractSubscriptionType(latest.rawJson) ??
              extractSubscriptionType(source5h?.rawJson ?? null) ??
              extractSubscriptionType(sourceWeek?.rawJson ?? null),
            quotaStatus: quotaStatus.state,
            quotaStatusLabel: quotaStatus.label,
            usage5hPercent: source5h?.usage5hPercent ?? null,
            usageWeekPercent: sourceWeek?.usageWeekPercent ?? null,
            usage5hStale: latest.usage5hPercent === null && source5h !== null,
            usageWeekStale: latest.usageWeekPercent === null && sourceWeek !== null,
            rawJson: null,
            usage5hResetAt,
            usageWeekResetAt,
          };
        }),
      };
    });

    return ok({ groups });
  } catch (error) {
    return serverError(error);
  }
}

type QuotaSnapshotRow = {
  email: string | null;
  authFileName: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
};

/**
 * Groups snapshots (already ordered newest-first) by account and, for each
 * account, exposes the latest snapshot plus the most recent snapshots that
 * still carry 5h / week usage values. When the latest refresh failed or the
 * account died, its usage columns are null, so we fall back to the last known
 * values instead of showing nothing. The account's status still comes from the
 * latest snapshot, so exception accounts remain excluded from averages.
 */
function groupByAccount<T extends QuotaSnapshotRow>(rows: T[]) {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.email || row.authFileName;
    if (!key) {
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    return {
      latest: group[0],
      source5h: group.find((row) => row.usage5hPercent !== null) ?? null,
      sourceWeek: group.find((row) => row.usageWeekPercent !== null) ?? null,
    };
  });
}
