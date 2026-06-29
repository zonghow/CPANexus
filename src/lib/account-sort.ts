import type { AccountQuotaState } from "./account-quota-status";

export type AccountSortRow = {
  subscriptionType: string | null;
  quotaStatus?: AccountQuotaState;
  usageWeekPercent?: number | null;
  email?: string | null;
  fileName?: string | null;
};

const knownSubscriptionRanks: Record<string, number> = {
  pro: 0,
  pro20x: 0,
  "pro-20x": 0,
  pro_20x: 0,
  prolite: 1,
  "pro-lite": 1,
  pro_lite: 1,
  pro5x: 1,
  "pro-5x": 1,
  pro_5x: 1,
  team: 2,
  plus: 3,
  free: 4,
};

const accountNameCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function sortAccountRows<T extends AccountSortRow>(rows: T[]) {
  return [...rows].sort(compareAccountRows);
}

function compareAccountRows(a: AccountSortRow, b: AccountSortRow) {
  const statusDiff = accountStatusSortRank(a.quotaStatus) - accountStatusSortRank(b.quotaStatus);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  // 限额账号在状态相同的前提下，进一步按周限（周用量百分比）从低到高排序，
  // 让周配额剩余更多、更快恢复的账号排在前面。
  if (a.quotaStatus === "limited" && b.quotaStatus === "limited") {
    const weekDiff = weeklyUsageSortValue(a.usageWeekPercent) - weeklyUsageSortValue(b.usageWeekPercent);
    if (weekDiff !== 0) {
      return weekDiff;
    }
  }

  const tierDiff = subscriptionSortRank(a.subscriptionType) - subscriptionSortRank(b.subscriptionType);
  if (tierDiff !== 0) {
    return tierDiff;
  }

  return accountNameCollator.compare(accountSortName(a), accountSortName(b));
}

function subscriptionSortRank(value: string | null) {
  if (!value) {
    return 99;
  }

  return knownSubscriptionRanks[value.trim().toLowerCase()] ?? 98;
}

function weeklyUsageSortValue(value: number | null | undefined) {
  // 无周限数据的账号排在最后。
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function accountStatusSortRank(value: AccountQuotaState | undefined) {
  if (value === "limited") {
    return 1;
  }
  if (value === "disabled") {
    return 2;
  }
  if (value === "exception") {
    return 3;
  }
  return 0;
}

function accountSortName(row: AccountSortRow) {
  return row.email?.trim() || row.fileName?.trim() || "";
}
