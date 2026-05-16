import { describe, expect, it } from "vitest";

import { cpaTableUpdatingIdsForJob, jobFinishedAtOrAfter } from "./cpa-sync-targets";

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
      cpaTableUpdatingIdsForJob("legacy-removed-job", [
        { id: 1, enabled: true },
      ]),
    ).toEqual([]);
  });

  it("detects whether a scheduled job run has finished after the scheduled time", () => {
    expect(
      jobFinishedAtOrAfter(
        { lastRunAt: "2026-05-16T14:10:03.000Z" },
        "2026-05-16T14:10:00.000Z",
      ),
    ).toBe(true);
    expect(
      jobFinishedAtOrAfter(
        { lastRunAt: "2026-05-16T14:09:59.000Z" },
        "2026-05-16T14:10:00.000Z",
      ),
    ).toBe(false);
    expect(jobFinishedAtOrAfter({ lastRunAt: null }, "2026-05-16T14:10:00.000Z")).toBe(false);
    expect(jobFinishedAtOrAfter({ lastRunAt: "bad-date" }, "2026-05-16T14:10:00.000Z")).toBe(false);
  });
});
