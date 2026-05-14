import type { NormalizedQuotaSnapshot } from "./quota";

export type ReplenishmentStrategyInput = {
  enabled: boolean;
  minAvailableAccounts: number;
  maintain5hUsagePercent: number;
  maintainWeekUsagePercent: number;
  maxBatchSize: number;
};

export type AuthFileAvailability = {
  email: string | null;
  available: boolean;
};

export type BackupAccountCandidate = {
  id: number;
  email: string;
  refreshToken: string;
  assignedCpaInstanceId: number | null;
  exception: string | null;
};

export type ProxyCandidate = {
  id: number;
  url: string;
  maxAuthFiles: number;
  currentAuthFiles: number;
  cpaInstanceIds: number[];
};

export type ReplenishmentPlanInput = {
  cpaInstanceId: number;
  strategy: ReplenishmentStrategyInput;
  authFiles: AuthFileAvailability[];
  quotaSnapshots: Pick<
    NormalizedQuotaSnapshot,
    "email" | "usage5hPercent" | "usageWeekPercent" | "available"
  >[];
  backupAccounts: BackupAccountCandidate[];
  proxies: ProxyCandidate[];
};

export type ReplenishmentReason =
  | "available_accounts_below_target"
  | "usage_5h_below_target"
  | "usage_week_below_target";

export type ReplenishmentUpload = BackupAccountCandidate & {
  proxy: { id: number; url: string } | null;
};

export type ReplenishmentPlan = {
  shouldUpload: boolean;
  reasonCodes: ReplenishmentReason[];
  accountsToUpload: ReplenishmentUpload[];
};

export function planReplenishment(input: ReplenishmentPlanInput): ReplenishmentPlan {
  if (!input.strategy.enabled) {
    return { shouldUpload: false, reasonCodes: [], accountsToUpload: [] };
  }

  const reasonCodes: ReplenishmentReason[] = [];
  const availableAuthCount = input.authFiles.filter((authFile) => authFile.available).length;
  const availableDeficit = Math.max(0, input.strategy.minAvailableAccounts - availableAuthCount);

  if (availableDeficit > 0) {
    reasonCodes.push("available_accounts_below_target");
  }

  const average5h = average(
    input.quotaSnapshots.map((snapshot) => snapshot.usage5hPercent),
  );
  if (
    average5h !== null &&
    average5h < input.strategy.maintain5hUsagePercent
  ) {
    reasonCodes.push("usage_5h_below_target");
  }

  const averageWeek = average(
    input.quotaSnapshots.map((snapshot) => snapshot.usageWeekPercent),
  );
  if (
    averageWeek !== null &&
    averageWeek < input.strategy.maintainWeekUsagePercent
  ) {
    reasonCodes.push("usage_week_below_target");
  }

  const maxBatchSize = Math.max(1, input.strategy.maxBatchSize);
  const requestedByUsage = reasonCodes.some((code) => code.startsWith("usage_")) ? 1 : 0;
  const requestedUploads = Math.min(maxBatchSize, Math.max(availableDeficit, requestedByUsage));

  const candidates = input.backupAccounts.filter(
    (account) => account.assignedCpaInstanceId === null && !account.exception,
  );
  const proxyPicker = createProxyPicker(input.cpaInstanceId, input.proxies);
  const accountsToUpload = candidates.slice(0, requestedUploads).map((account) => ({
    ...account,
    proxy: proxyPicker(),
  }));

  return {
    shouldUpload: accountsToUpload.length > 0,
    reasonCodes,
    accountsToUpload,
  };
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function createProxyPicker(cpaInstanceId: number, proxies: ProxyCandidate[]) {
  const mutable = proxies
    .filter(
      (proxy) =>
        proxy.url.trim() &&
        proxy.cpaInstanceIds.includes(cpaInstanceId) &&
        proxy.currentAuthFiles < proxy.maxAuthFiles,
    )
    .map((proxy) => ({ ...proxy }));

  return () => {
    const proxy = mutable.find((candidate) => candidate.currentAuthFiles < candidate.maxAuthFiles);
    if (!proxy) {
      return null;
    }

    proxy.currentAuthFiles += 1;
    return { id: proxy.id, url: proxy.url };
  };
}
