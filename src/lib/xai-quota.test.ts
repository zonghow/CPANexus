import { describe, expect, it } from "vitest";

import {
  buildXaiBillingSummary,
  mergeXaiBillingSummaries,
  xaiBillingToQuotaPercents,
} from "./xai-quota";

describe("xai-quota", () => {
  it("builds weekly and monthly billing summaries", () => {
    const weekly = buildXaiBillingSummary({
      credit_usage_percent: 42,
      current_period: {
        type: "weekly",
        start: "2026-07-01T00:00:00Z",
        end: "2026-07-08T00:00:00Z",
      },
      product_usage: [{ product: "Grok", usage_percent: 10 }],
    });
    const monthly = buildXaiBillingSummary({
      monthly_limit: { val: 15000 },
      used: { val: 3000 },
      billing_period_end: "2026-08-01T00:00:00Z",
    });

    expect(weekly).toMatchObject({
      periodType: "weekly",
      usagePercent: 42,
    });
    expect(monthly).toMatchObject({
      monthlyLimitCents: 15000,
      usedPercent: 20,
    });

    const merged = mergeXaiBillingSummaries(weekly, monthly);
    expect(merged).toMatchObject({
      usagePercent: 42,
      monthlyLimitCents: 15000,
      usedPercent: 20,
    });

    expect(xaiBillingToQuotaPercents(merged!)).toEqual({
      usageWeekPercent: 42,
      usage5hPercent: 20,
      available: true,
      planLabel: "SuperGrok",
    });
  });
});
