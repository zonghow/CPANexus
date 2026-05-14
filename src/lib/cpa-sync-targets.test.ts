import { describe, expect, it } from "vitest";

import { cpaTableUpdatingIdsForJob } from "./cpa-sync-targets";

describe("cpaTableUpdatingIdsForJob", () => {
  it("marks enabled CPA tables while the global sync job is running", () => {
    expect(
      cpaTableUpdatingIdsForJob("sync-cpa-instances", [
        { id: 1, enabled: true },
        { id: 2, enabled: false },
        { id: 3, enabled: true },
      ]),
    ).toEqual([1, 3]);
  });

  it("does not mark account tables for other jobs", () => {
    expect(
      cpaTableUpdatingIdsForJob("auto-replenish", [
        { id: 1, enabled: true },
      ]),
    ).toEqual([]);
  });
});
