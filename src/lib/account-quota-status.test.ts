import { describe, expect, it } from "vitest";

import { resolveAccountQuotaStatus } from "./account-quota-status";

describe("resolveAccountQuotaStatus", () => {
  it("classifies rate-limit reached rows as limited instead of exception", () => {
    expect(
      resolveAccountQuotaStatus({
        disabled: false,
        available: false,
        exception: null,
        rawJson: JSON.stringify({
          rate_limit: {
            allowed: false,
            limit_reached: true,
          },
          rate_limit_reached_type: {
            type: "rate_limit_reached",
          },
        }),
      }),
    ).toEqual({
      state: "limited",
      label: "限额",
    });
  });

  it("classifies real quota exceptions as exception", () => {
    expect(
      resolveAccountQuotaStatus({
        disabled: false,
        available: false,
        exception: "refresh token expired",
        rawJson: null,
      }),
    ).toEqual({
      state: "exception",
      label: "refresh token expired",
    });
  });

  it("keeps disabled and available states distinct", () => {
    expect(
      resolveAccountQuotaStatus({
        disabled: true,
        available: false,
        exception: null,
        rawJson: null,
      }),
    ).toEqual({ state: "disabled", label: "停用" });

    expect(
      resolveAccountQuotaStatus({
        disabled: false,
        available: true,
        exception: null,
        rawJson: null,
      }),
    ).toEqual({ state: "available", label: "可用" });
  });
});
