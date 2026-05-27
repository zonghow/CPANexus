import type { AccountQuotaState } from "./account-quota-status";
import {
  isFreeSubscriptionType,
  subscriptionAverageWeight,
} from "./subscription";

type AverageAccountQuotaState = AccountQuotaState | "pending";

export type AccountRemainingPercentRow = {
  subscriptionType: string | null;
  quotaStatus?: AverageAccountQuotaState;
  usage5hPercent?: number | null;
  usageWeekPercent?: number | null;
};

export function averageRemainingPercent(values: Array<number | null | undefined>) {
  const remainingValues = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(100, 100 - value)));

  if (remainingValues.length === 0) {
    return null;
  }

  const average = remainingValues.reduce((sum, value) => sum + value, 0) / remainingValues.length;
  return Math.round(average);
}

export function averageAccountRemainingPercent(
  rows: AccountRemainingPercentRow[],
  key: "usage5hPercent" | "usageWeekPercent",
) {
  let totalWeight = 0;
  let weightedRemaining = 0;

  for (const row of rows) {
    if (
      isFreeSubscriptionType(row.subscriptionType) ||
      row.quotaStatus === "exception" ||
      row.quotaStatus === "disabled" ||
      row.quotaStatus === "pending"
    ) {
      continue;
    }

    const remaining = getRemainingPercent(row[key], row.quotaStatus);
    if (remaining === null) {
      continue;
    }

    const weight = subscriptionAverageWeight(row.subscriptionType);
    totalWeight += weight;
    weightedRemaining += remaining * weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  return Math.round(weightedRemaining / totalWeight);
}

function getRemainingPercent(
  usagePercent: number | null | undefined,
  quotaStatus: AverageAccountQuotaState | undefined,
) {
  if (typeof usagePercent === "number" && Number.isFinite(usagePercent)) {
    return Math.max(0, Math.min(100, 100 - usagePercent));
  }

  if (quotaStatus === "limited") {
    return 0;
  }

  return null;
}
