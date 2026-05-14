import { describe, expect, it } from "vitest";

import { summarizeDashboardStats } from "./dashboard-summary";

describe("summarizeDashboardStats", () => {
  it("counts CPA-dependent stats only for enabled CPA instances", () => {
    const stats = summarizeDashboardStats({
      cpaInstances: [
        { id: 1, enabled: true },
        { id: 2, enabled: false },
        { id: 3, enabled: true },
      ],
      authFiles: [
        { cpaInstanceId: 1, available: true },
        { cpaInstanceId: 1, available: false },
        { cpaInstanceId: 2, available: true },
      ],
      quotaSnapshots: [
        { cpaInstanceId: 1, usage5hPercent: 20, usageWeekPercent: 50 },
        { cpaInstanceId: 1, usage5hPercent: 40, usageWeekPercent: 70 },
        { cpaInstanceId: 2, usage5hPercent: 0, usageWeekPercent: 0 },
        { cpaInstanceId: 3, usage5hPercent: 10, usageWeekPercent: 20 },
      ],
      backupAccounts: [
        { assignedCpaInstanceId: null },
        { assignedCpaInstanceId: 1 },
      ],
      proxies: [
        { id: 1, enabled: true },
        { id: 2, enabled: true },
        { id: 3, enabled: false },
      ],
      proxyCpaInstances: [
        { proxyId: 1, cpaInstanceId: 1 },
        { proxyId: 2, cpaInstanceId: 2 },
        { proxyId: 3, cpaInstanceId: 3 },
      ],
    });

    expect(stats).toMatchObject({
      totalInstances: 3,
      instances: 2,
      enabledInstances: 2,
      authFiles: 2,
      availableAuthFiles: 1,
      idleBackupAccounts: 1,
      proxies: 1,
      average5hRemainingPercent: 80,
      averageWeekRemainingPercent: 60,
    });
  });
});
