import { matchesAuthView } from "./auth-provider";

type CpaInstanceLike = {
  id: number;
  enabled: boolean;
};

type AuthFileLike = {
  cpaInstanceId: number;
  available: boolean;
  provider?: string | null;
};

type QuotaSnapshotLike = {
  cpaInstanceId: number;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
};

type ProxyLike = {
  id: number;
  enabled: boolean;
};

type ProxyCpaInstanceLike = {
  proxyId: number;
  cpaInstanceId: number;
};

export type DashboardStats = {
  totalInstances: number;
  instances: number;
  enabledInstances: number;
  authFiles: number;
  availableAuthFiles: number;
  proxies: number;
  average5hRemainingPercent: number | null;
  averageWeekRemainingPercent: number | null;
};

export function summarizeDashboardStats(input: {
  cpaInstances: CpaInstanceLike[];
  authFiles: AuthFileLike[];
  quotaSnapshots: QuotaSnapshotLike[];
  proxies: ProxyLike[];
  proxyCpaInstances: ProxyCpaInstanceLike[];
}): DashboardStats {
  const enabledInstanceIds = new Set(
    input.cpaInstances
      .filter((instance) => instance.enabled)
      .map((instance) => instance.id),
  );

  const enabledAuthFiles = input.authFiles.filter(
    (authFile) =>
      enabledInstanceIds.has(authFile.cpaInstanceId) &&
      matchesAuthView(authFile.provider, "codex"),
  );
  const enabledProxyIds = new Set(
    input.proxyCpaInstances
      .filter((row) => enabledInstanceIds.has(row.cpaInstanceId))
      .map((row) => row.proxyId),
  );

  return {
    totalInstances: input.cpaInstances.length,
    instances: enabledInstanceIds.size,
    enabledInstances: enabledInstanceIds.size,
    authFiles: enabledAuthFiles.length,
    availableAuthFiles: enabledAuthFiles.filter((authFile) => authFile.available).length,
    proxies: input.proxies.filter((proxy) => proxy.enabled && enabledProxyIds.has(proxy.id)).length,
    average5hRemainingPercent: averageCpaRemainingPercent(
      [...enabledInstanceIds],
      input.quotaSnapshots,
      "usage5hPercent",
    ),
    averageWeekRemainingPercent: averageCpaRemainingPercent(
      [...enabledInstanceIds],
      input.quotaSnapshots,
      "usageWeekPercent",
    ),
  };
}

function averageCpaRemainingPercent(
  cpaInstanceIds: number[],
  quotaSnapshots: QuotaSnapshotLike[],
  key: "usage5hPercent" | "usageWeekPercent",
) {
  const cpaAverages = cpaInstanceIds
    .map((cpaInstanceId) => {
      const remainingValues = quotaSnapshots
        .filter((snapshot) => snapshot.cpaInstanceId === cpaInstanceId)
        .map((snapshot) => snapshot[key])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Math.max(0, Math.min(100, 100 - value)));

      if (remainingValues.length === 0) {
        return null;
      }

      return average(remainingValues);
    })
    .filter((value): value is number => value !== null);

  if (cpaAverages.length === 0) {
    return null;
  }

  return Math.round(average(cpaAverages));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
