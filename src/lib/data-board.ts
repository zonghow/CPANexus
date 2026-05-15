type CpaInstanceLike = {
  id: number;
  name: string;
  enabled: boolean;
};

type AuthFileLike = {
  cpaInstanceId: number;
  available: boolean;
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

export type DashboardMetricSnapshotLike = {
  cpaInstanceId: number;
  accountCount: number;
  availableAccountCount: number;
  average5hRemainingPercent: number | null;
  averageWeekRemainingPercent: number | null;
  proxyCount: number;
  capturedAt: string;
};

export type DataBoardStats = {
  selectedCpaInstanceIds: number[];
  accountCount: number;
  availableAccountCount: number;
  availableRate: number;
  proxyCount: number;
  average5hRemainingPercent: number | null;
  averageWeekRemainingPercent: number | null;
};

export type DataBoardSeriesPoint = Omit<DataBoardStats, "selectedCpaInstanceIds"> & {
  capturedAt: string;
};

export const maxDataBoardSeriesPoints = 5000;

export function summarizeDataBoard(
  input: {
    cpaInstances: CpaInstanceLike[];
    authFiles: AuthFileLike[];
    quotaSnapshots: QuotaSnapshotLike[];
    proxies: ProxyLike[];
    proxyCpaInstances: ProxyCpaInstanceLike[];
  },
  selectedCpaInstanceIds: number[] = [],
): DataBoardStats {
  const scopeIds = enabledScopeIds(input.cpaInstances, selectedCpaInstanceIds);
  const scopeSet = new Set(scopeIds);
  const scopedAuthFiles = input.authFiles.filter((authFile) =>
    scopeSet.has(authFile.cpaInstanceId),
  );
  const enabledProxyIds = new Set(input.proxies.filter((proxy) => proxy.enabled).map((proxy) => proxy.id));
  const scopedProxyIds = new Set(
    input.proxyCpaInstances
      .filter((row) => scopeSet.has(row.cpaInstanceId) && enabledProxyIds.has(row.proxyId))
      .map((row) => row.proxyId),
  );
  const availableAccountCount = scopedAuthFiles.filter((authFile) => authFile.available).length;

  return {
    selectedCpaInstanceIds: scopeIds,
    accountCount: scopedAuthFiles.length,
    availableAccountCount,
    availableRate: percent(availableAccountCount, scopedAuthFiles.length),
    proxyCount: scopedProxyIds.size,
    average5hRemainingPercent: averageCpaRemainingPercent(scopeIds, input.quotaSnapshots, "usage5hPercent"),
    averageWeekRemainingPercent: averageCpaRemainingPercent(scopeIds, input.quotaSnapshots, "usageWeekPercent"),
  };
}

export function buildDashboardMetricSnapshot(
  input: {
    cpaInstances: CpaInstanceLike[];
    authFiles: AuthFileLike[];
    quotaSnapshots: QuotaSnapshotLike[];
    proxies: ProxyLike[];
    proxyCpaInstances: ProxyCpaInstanceLike[];
  },
  cpaInstanceId: number,
  capturedAt: string,
): DashboardMetricSnapshotLike | null {
  const stats = summarizeDataBoard(input, [cpaInstanceId]);
  if (!stats.selectedCpaInstanceIds.includes(cpaInstanceId)) {
    return null;
  }

  return {
    cpaInstanceId,
    accountCount: stats.accountCount,
    availableAccountCount: stats.availableAccountCount,
    average5hRemainingPercent: stats.average5hRemainingPercent,
    averageWeekRemainingPercent: stats.averageWeekRemainingPercent,
    proxyCount: stats.proxyCount,
    capturedAt,
  };
}

export function buildDataBoardSeries(
  input: {
    cpaInstances: CpaInstanceLike[];
    snapshots: DashboardMetricSnapshotLike[];
  },
  selectedCpaInstanceIds: number[] = [],
): DataBoardSeriesPoint[] {
  const scopeIds = enabledScopeIds(input.cpaInstances, selectedCpaInstanceIds);
  const scopeSet = new Set(scopeIds);
  const relevantSnapshots = input.snapshots
    .filter((snapshot) => scopeSet.has(snapshot.cpaInstanceId))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const times = [...new Set(relevantSnapshots.map((snapshot) => snapshot.capturedAt))];
  const latestByCpa = new Map<number, DashboardMetricSnapshotLike>();
  const points: DataBoardSeriesPoint[] = [];
  let cursor = 0;

  for (const capturedAt of times) {
    while (
      cursor < relevantSnapshots.length &&
      relevantSnapshots[cursor]!.capturedAt <= capturedAt
    ) {
      const snapshot = relevantSnapshots[cursor]!;
      latestByCpa.set(snapshot.cpaInstanceId, snapshot);
      cursor += 1;
    }

    const snapshots = scopeIds
      .map((cpaInstanceId) => latestByCpa.get(cpaInstanceId))
      .filter((snapshot): snapshot is DashboardMetricSnapshotLike => Boolean(snapshot));

    if (snapshots.length === 0) {
      continue;
    }

    points.push(aggregateMetricSnapshots(capturedAt, snapshots));
  }

  return points;
}

export function limitDataBoardSeries(
  series: DataBoardSeriesPoint[],
  maxPoints = maxDataBoardSeriesPoints,
) {
  if (series.length <= maxPoints) {
    return series;
  }
  if (maxPoints <= 0) {
    return [];
  }

  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor((index * series.length) / maxPoints);
    const end = Math.floor(((index + 1) * series.length) / maxPoints);
    const bucket = series.slice(start, Math.max(start + 1, end));
    const last = bucket[bucket.length - 1]!;

    return {
      capturedAt: last.capturedAt,
      accountCount: sumNumbers(bucket.map((point) => point.accountCount)),
      availableAccountCount: sumNumbers(bucket.map((point) => point.availableAccountCount)),
      availableRate: averageNumbers(bucket.map((point) => point.availableRate)) ?? 0,
      proxyCount: Math.max(...bucket.map((point) => point.proxyCount)),
      average5hRemainingPercent: averageNumbers(bucket.map((point) => point.average5hRemainingPercent)),
      averageWeekRemainingPercent: averageNumbers(bucket.map((point) => point.averageWeekRemainingPercent)),
    };
  });
}

function aggregateMetricSnapshots(
  capturedAt: string,
  snapshots: DashboardMetricSnapshotLike[],
): DataBoardSeriesPoint {
  const accountCount = snapshots.reduce((sum, snapshot) => sum + snapshot.accountCount, 0);
  const availableAccountCount = snapshots.reduce(
    (sum, snapshot) => sum + snapshot.availableAccountCount,
    0,
  );

  return {
    capturedAt,
    accountCount,
    availableAccountCount,
    availableRate: percent(availableAccountCount, accountCount),
    proxyCount: snapshots.reduce((sum, snapshot) => sum + snapshot.proxyCount, 0),
    average5hRemainingPercent: averageNumbers(
      snapshots.map((snapshot) => snapshot.average5hRemainingPercent),
    ),
    averageWeekRemainingPercent: averageNumbers(
      snapshots.map((snapshot) => snapshot.averageWeekRemainingPercent),
    ),
  };
}

function enabledScopeIds(
  cpaInstances: CpaInstanceLike[],
  selectedCpaInstanceIds: number[],
) {
  const selectedSet = new Set(selectedCpaInstanceIds);
  const hasSelection = selectedSet.size > 0;
  return cpaInstances
    .filter((instance) => instance.enabled)
    .filter((instance) => !hasSelection || selectedSet.has(instance.id))
    .map((instance) => instance.id);
}

function averageCpaRemainingPercent(
  cpaInstanceIds: number[],
  quotaSnapshots: QuotaSnapshotLike[],
  key: "usage5hPercent" | "usageWeekPercent",
) {
  return averageNumbers(
    cpaInstanceIds.map((cpaInstanceId) =>
      averageNumbers(
        quotaSnapshots
          .filter((snapshot) => snapshot.cpaInstanceId === cpaInstanceId)
          .map((snapshot) => snapshot[key])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          .map((value) => Math.max(0, Math.min(100, 100 - value))),
      ),
    ),
  );
}

function averageNumbers(values: Array<number | null>) {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finiteValues.length === 0) {
    return null;
  }

  return Math.round(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length);
}

function sumNumbers(values: number[]) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}
