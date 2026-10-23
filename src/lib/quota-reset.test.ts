import { describe, expect, it } from "vitest";

import { extractQuotaResetTimes } from "./quota-reset";

describe("extractQuotaResetTimes", () => {
  it("extracts reset times from Codex rate-limit windows", () => {
    const result = extractQuotaResetTimes(
      JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: 18,
            limit_window_seconds: 18_000,
            reset_after_seconds: 90,
          },
          secondary_window: {
            used_percent: 25,
            limit_window_seconds: 604_800,
            reset_at: 1_778_958_879,
          },
        },
      }),
      "2026-05-16T10:00:00.000Z",
    );

    expect(result).toEqual({
      usage5hResetAt: "2026-05-16T10:01:30.000Z",
      usageWeekResetAt: "2026-05-16T19:14:39.000Z",
    });
  });

  it("extracts reset times from direct quota windows", () => {
    const result = extractQuotaResetTimes(
      JSON.stringify({
        quota: {
          fiveHour: { resetAt: "2026-05-16T12:00:00.000Z" },
          weekly: { resetAfterSeconds: 3600 },
        },
      }),
      "2026-05-16T10:00:00.000Z",
    );

    expect(result).toEqual({
      usage5hResetAt: "2026-05-16T12:00:00.000Z",
      usageWeekResetAt: "2026-05-16T11:00:00.000Z",
    });
  });

  it("extracts reset times from Claude usage summaries", () => {
    const result = extractQuotaResetTimes(
      JSON.stringify({
        provider: "claude",
        plan: "Max",
        usage: {
          fiveHourUsedPercent: 100,
          fiveHourResetsAt: "2026-10-23T15:09:59.810910+00:00",
          sevenDayUsedPercent: 14,
          sevenDayResetsAt: "2026-10-30T08:59:59.810937+00:00",
          windows: [
            { id: "five-hour", usedPercent: 100, resetsAt: "2026-10-23T15:09:59.810910+00:00" },
            { id: "seven-day", usedPercent: 14, resetsAt: "2026-10-30T08:59:59.810937+00:00" },
          ],
          extraUsage: null,
        },
      }),
      "2026-10-23T12:37:04.898Z",
    );

    expect(result).toEqual({
      usage5hResetAt: "2026-10-23T15:09:59.810Z",
      usageWeekResetAt: "2026-10-30T08:59:59.810Z",
    });
  });

  it("maps Grok weekly and monthly billing periods to the week and 5h slots", () => {
    const result = extractQuotaResetTimes(
      JSON.stringify({
        provider: "xai",
        plan: "SuperGrok",
        billing: {
          periodType: "weekly",
          usagePercent: 46,
          periodStart: "2026-10-17T09:47:57.695244+00:00",
          periodEnd: "2026-10-24T09:47:57.695244+00:00",
          monthlyLimitCents: 15000,
          usedCents: 3000,
          billingPeriodStart: "2026-10-01T00:00:00+00:00",
          billingPeriodEnd: "2026-11-01T00:00:00+00:00",
          usedPercent: 20,
        },
      }),
      "2026-10-22T13:39:54.646Z",
    );

    expect(result).toEqual({
      usage5hResetAt: "2026-11-01T00:00:00.000Z",
      usageWeekResetAt: "2026-10-24T09:47:57.695Z",
    });
  });

  it("skips Grok reset times for windows without usage", () => {
    const result = extractQuotaResetTimes(
      JSON.stringify({
        provider: "xai",
        plan: null,
        billing: {
          periodType: "weekly",
          usagePercent: 46,
          periodEnd: "2026-10-24T09:47:57.695244+00:00",
          monthlyLimitCents: 0,
          usedCents: 0,
          billingPeriodEnd: "2026-11-01T00:00:00+00:00",
          usedPercent: null,
        },
      }),
      "2026-10-22T13:39:54.646Z",
    );

    expect(result).toEqual({
      usage5hResetAt: null,
      usageWeekResetAt: "2026-10-24T09:47:57.695Z",
    });
  });
});
