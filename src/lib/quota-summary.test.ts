import { describe, expect, it } from "vitest";

import { averageRemainingPercent } from "./quota-summary";

describe("averageRemainingPercent", () => {
  it("averages remaining percent from usage percent values", () => {
    expect(averageRemainingPercent([20, 40, null, 10])).toBe(77);
  });

  it("returns null when no usage data is available", () => {
    expect(averageRemainingPercent([null, undefined])).toBeNull();
  });
});
