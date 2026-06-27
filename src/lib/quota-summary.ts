import type { AccountQuotaState } from "./account-quota-status";
import {
  isFreeSubscriptionType,
  normalizeSubscriptionType,
  subscriptionAverageWeight,
} from "./subscription";

type AverageAccountQuotaState = AccountQuotaState | "pending";

/**
 * Optional per-subscription-type weights (e.g. configured dollar quotas). When
 * provided and a positive weight exists for an account's type, it is used as
 * the averaging weight instead of the default relative weight, producing a
 * dollar-accurate weighted remaining percentage.
 */
export type SubscriptionWeightMap = Partial<Record<string, number>>;

export type SubscriptionQuotaSetting = {
  subscriptionType: string;
  usage5hDollars: number | null;
  usageWeekDollars: number | null;
};

/**
 * Builds the averaging weight map for a given usage window from the configured
 * dollar quotas. This is the single source of truth for turning quota settings
 * into weights, shared by the account management page and message push so both
 * always use the same algorithm.
 */
export function buildSubscriptionWeightMap(
  settings: SubscriptionQuotaSetting[],
  key: "usage5hPercent" | "usageWeekPercent",
): SubscriptionWeightMap {
  const dollarKey =
    key === "usage5hPercent" ? "usage5hDollars" : "usageWeekDollars";
  return Object.fromEntries(
    settings
      .map((setting) => [setting.subscriptionType, setting[dollarKey]] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] > 0,
      ),
  );
}

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
  weightByType?: SubscriptionWeightMap,
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

    const remaining = accountRemainingPercent(row, key);
    if (remaining === null) {
      continue;
    }

    const weight = resolveSubscriptionWeight(row.subscriptionType, weightByType);
    totalWeight += weight;
    weightedRemaining += remaining * weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  return Math.round(weightedRemaining / totalWeight);
}

function resolveSubscriptionWeight(
  subscriptionType: string | null,
  weightByType?: SubscriptionWeightMap,
) {
  if (weightByType) {
    const canonical = normalizeSubscriptionType(subscriptionType);
    const configured = canonical ? weightByType[canonical] : undefined;
    if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
  }

  return subscriptionAverageWeight(subscriptionType);
}

/**
 * Returns the configured full dollar quota for an account's subscription type,
 * or null when no positive quota is configured for that type.
 */
export function accountQuotaDollars(
  subscriptionType: string | null,
  weightByType?: SubscriptionWeightMap,
): number | null {
  if (!weightByType) {
    return null;
  }
  const canonical = normalizeSubscriptionType(subscriptionType);
  const value = canonical ? weightByType[canonical] : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export type RemainingDollars = {
  remaining: number;
  total: number;
};

/**
 * Aggregates remaining and total dollar quota across the accounts that count
 * toward the average (same exclusions: free, exception, disabled, pending) and
 * that have a configured dollar quota. Returns null when no such account
 * exists, so callers can hide the dollar tooltip.
 */
export function subscriptionRemainingDollars(
  rows: AccountRemainingPercentRow[],
  key: "usage5hPercent" | "usageWeekPercent",
  weightByType?: SubscriptionWeightMap,
): RemainingDollars | null {
  if (!weightByType) {
    return null;
  }

  let remaining = 0;
  let total = 0;
  let hasAny = false;

  for (const row of rows) {
    if (
      isFreeSubscriptionType(row.subscriptionType) ||
      row.quotaStatus === "exception" ||
      row.quotaStatus === "disabled" ||
      row.quotaStatus === "pending"
    ) {
      continue;
    }

    const dollars = accountQuotaDollars(row.subscriptionType, weightByType);
    if (dollars === null) {
      continue;
    }

    const remainingPercent = accountRemainingPercent(row, key);
    if (remainingPercent === null) {
      continue;
    }

    total += dollars;
    remaining += (dollars * remainingPercent) / 100;
    hasAny = true;
  }

  return hasAny ? { remaining, total } : null;
}

/**
 * Computes an account's remaining percentage for a window, preferring the real
 * usage data. Two cross-cutting rules apply:
 *  - When the weekly quota is known (from real data) to be exhausted (0
 *    remaining), the account is effectively unusable, so any window (including
 *    5h) is treated as 0 regardless of what the API reported for that window.
 *  - When a window has no usage data but the account is rate-limited, it is
 *    treated as 0 (exhausted) rather than skipped.
 */
function accountRemainingPercent(
  row: AccountRemainingPercentRow,
  key: "usage5hPercent" | "usageWeekPercent",
): number | null {
  if (usageToRemaining(row.usageWeekPercent) === 0) {
    return 0;
  }

  const usagePercent =
    key === "usageWeekPercent" ? row.usageWeekPercent : row.usage5hPercent;
  return windowRemainingPercent(usagePercent, row.quotaStatus);
}

function usageToRemaining(usagePercent: number | null | undefined) {
  if (typeof usagePercent === "number" && Number.isFinite(usagePercent)) {
    return Math.max(0, Math.min(100, 100 - usagePercent));
  }
  return null;
}

function windowRemainingPercent(
  usagePercent: number | null | undefined,
  quotaStatus: AverageAccountQuotaState | undefined,
) {
  const remaining = usageToRemaining(usagePercent);
  if (remaining !== null) {
    return remaining;
  }

  if (quotaStatus === "limited") {
    return 0;
  }

  return null;
}
