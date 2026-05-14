import { describe, expect, it } from "vitest";

import { planReplenishment } from "./replenishment";

describe("planReplenishment", () => {
  it("uploads enough backup accounts when available auth count is below target", () => {
    const plan = planReplenishment({
      cpaInstanceId: 1,
      strategy: {
        enabled: true,
        minAvailableAccounts: 3,
        maintain5hUsagePercent: 20,
        maintainWeekUsagePercent: 20,
        maxBatchSize: 5,
      },
      authFiles: [
        { email: "used@example.com", available: true },
        { email: "bad@example.com", available: false },
      ],
      quotaSnapshots: [],
      backupAccounts: [
        { id: 1, email: "one@example.com", refreshToken: "rt_one", assignedCpaInstanceId: null, exception: null },
        { id: 2, email: "two@example.com", refreshToken: "rt_two", assignedCpaInstanceId: null, exception: null },
        { id: 3, email: "three@example.com", refreshToken: "rt_three", assignedCpaInstanceId: null, exception: null },
      ],
      proxies: [],
    });

    expect(plan.reasonCodes).toContain("available_accounts_below_target");
    expect(plan.accountsToUpload.map((account) => account.email)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
  });

  it("triggers one upload when usage averages are below thresholds", () => {
    const plan = planReplenishment({
      cpaInstanceId: 2,
      strategy: {
        enabled: true,
        minAvailableAccounts: 1,
        maintain5hUsagePercent: 80,
        maintainWeekUsagePercent: 75,
        maxBatchSize: 2,
      },
      authFiles: [{ email: "active@example.com", available: true }],
      quotaSnapshots: [
        { email: "active@example.com", usage5hPercent: 40, usageWeekPercent: 90, available: true },
      ],
      backupAccounts: [
        { id: 4, email: "next@example.com", refreshToken: "rt_next", assignedCpaInstanceId: null, exception: null },
      ],
      proxies: [],
    });

    expect(plan.reasonCodes).toEqual(["usage_5h_below_target"]);
    expect(plan.accountsToUpload).toHaveLength(1);
  });

  it("assigns the first compatible proxy with remaining capacity", () => {
    const plan = planReplenishment({
      cpaInstanceId: 10,
      strategy: {
        enabled: true,
        minAvailableAccounts: 2,
        maintain5hUsagePercent: 0,
        maintainWeekUsagePercent: 0,
        maxBatchSize: 2,
      },
      authFiles: [],
      quotaSnapshots: [],
      backupAccounts: [
        { id: 5, email: "proxied@example.com", refreshToken: "rt_proxy", assignedCpaInstanceId: null, exception: null },
      ],
      proxies: [
        { id: 1, url: "http://full.proxy", maxAuthFiles: 1, currentAuthFiles: 1, cpaInstanceIds: [10] },
        { id: 2, url: "http://open.proxy", maxAuthFiles: 2, currentAuthFiles: 0, cpaInstanceIds: [10] },
      ],
    });

    expect(plan.accountsToUpload[0]?.proxy).toEqual({
      id: 2,
      url: "http://open.proxy",
    });
  });
});
