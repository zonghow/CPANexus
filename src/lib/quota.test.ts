import { describe, expect, it } from "vitest";

import { normalizeQuotaPayload } from "./quota";

describe("normalizeQuotaPayload", () => {
  it("normalizes nested quota percent and remaining-limit fields", () => {
    const snapshots = normalizeQuotaPayload({
      accounts: [
        {
          email: "a@example.com",
          quota: {
            fiveHour: { used_percent: 72 },
            weekly: { remaining: 40, limit: 100 },
          },
        },
      ],
    });

    expect(snapshots).toEqual([
      {
        email: "a@example.com",
        authFileName: null,
        usage5hPercent: 72,
        usageWeekPercent: 60,
        available: true,
        exception: null,
        raw: expect.any(Object),
      },
    ]);
  });

  it("normalizes CPA auth-file shaped records and extracts refresh exceptions", () => {
    const snapshots = normalizeQuotaPayload({
      files: [
        {
          name: "codex-b@example.com-auto.json",
          email: "b@example.com",
          status: "error",
          status_message: "refresh token expired",
        },
      ],
    });

    expect(snapshots).toMatchObject([
      {
        email: "b@example.com",
        authFileName: "codex-b@example.com-auto.json",
        usage5hPercent: null,
        usageWeekPercent: null,
        available: false,
        exception: "refresh token expired",
      },
    ]);
  });

  it("accepts a top-level array payload", () => {
    const snapshots = normalizeQuotaPayload([
      {
        account: "c@example.com",
        used_5h_percent: 30,
        used_week_percent: 80,
      },
    ]);

    expect(snapshots[0]).toMatchObject({
      email: "c@example.com",
      usage5hPercent: 30,
      usageWeekPercent: 80,
      available: true,
    });
  });

  it("normalizes Codex wham usage rate-limit windows", () => {
    const snapshots = normalizeQuotaPayload({
      email: "d@example.com",
      name: "codex-d@example.com-auto.json",
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 13,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 75,
          limit_window_seconds: 604_800,
        },
      },
    });

    expect(snapshots[0]).toMatchObject({
      email: "d@example.com",
      authFileName: "codex-d@example.com-auto.json",
      usage5hPercent: 13,
      usageWeekPercent: 75,
      available: true,
      exception: null,
    });
  });
});
