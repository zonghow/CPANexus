import { describe, expect, it } from "vitest";

import {
  averageAccountRemainingPercent,
  averageRemainingPercent,
} from "./quota-summary";

describe("averageRemainingPercent", () => {
  it("averages remaining percent from usage percent values", () => {
    expect(averageRemainingPercent([20, 40, null, 10])).toBe(77);
  });

  it("returns null when no usage data is available", () => {
    expect(averageRemainingPercent([null, undefined])).toBeNull();
  });
});

describe("averageAccountRemainingPercent", () => {
  it("includes limited accounts as 0 remaining and ignores free or exception accounts", () => {
    expect(
      averageAccountRemainingPercent(
        [
          {
            subscriptionType: "plus",
            quotaStatus: "available",
            usage5hPercent: 50,
          },
          {
            subscriptionType: "plus",
            quotaStatus: "limited",
            usage5hPercent: 20,
          },
          {
            subscriptionType: "free",
            quotaStatus: "available",
            usage5hPercent: 0,
          },
          {
            subscriptionType: "plus",
            quotaStatus: "exception",
            usage5hPercent: 0,
          },
        ],
        "usage5hPercent",
      ),
    ).toBe(25);
  });

  it("treats limited weekly quota rows as 0 remaining even when usage is present", () => {
    expect(
      averageAccountRemainingPercent(
        [
          {
            subscriptionType: "plus",
            quotaStatus: "limited",
            usageWeekPercent: 20,
          },
        ],
        "usageWeekPercent",
      ),
    ).toBe(0);
  });

  it("weights Pro 5x and Pro 20x accounts as multiple Plus accounts", () => {
    expect(
      averageAccountRemainingPercent(
        [
          {
            subscriptionType: "plus",
            quotaStatus: "available",
            usage5hPercent: 20,
          },
          {
            subscriptionType: "pro_lite",
            quotaStatus: "available",
            usage5hPercent: 40,
          },
          {
            subscriptionType: "pro",
            quotaStatus: "available",
            usage5hPercent: 90,
          },
          {
            subscriptionType: "plus",
            quotaStatus: "limited",
            usage5hPercent: null,
          },
        ],
        "usage5hPercent",
      ),
    ).toBe(21);
  });

  it("returns null when every account should be skipped", () => {
    expect(
      averageAccountRemainingPercent(
        [
          {
            subscriptionType: "free",
            quotaStatus: "available",
            usageWeekPercent: 0,
          },
          {
            subscriptionType: "plus",
            quotaStatus: "exception",
            usageWeekPercent: 0,
          },
          {
            subscriptionType: "plus",
            quotaStatus: "pending",
            usageWeekPercent: null,
          },
        ],
        "usageWeekPercent",
      ),
    ).toBeNull();
  });
});
