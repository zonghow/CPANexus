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
});
