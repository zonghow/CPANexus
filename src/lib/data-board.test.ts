import { describe, expect, it } from "vitest";

import { buildDataBoardSeries, limitDataBoardSeries, summarizeDataBoard } from "./data-board";

describe("summarizeDataBoard", () => {
  it("aggregates current metrics for any number of selected enabled CPA instances", () => {
    const summary = summarizeDataBoard(
      {
        cpaInstances: [
          { id: 1, name: "alpha", enabled: true },
          { id: 2, name: "beta", enabled: true },
          { id: 3, name: "disabled", enabled: false },
        ],
        authFiles: [
          { cpaInstanceId: 1, available: true },
          { cpaInstanceId: 1, available: false },
          { cpaInstanceId: 2, available: true },
          { cpaInstanceId: 3, available: true },
        ],
        quotaSnapshots: [
          { cpaInstanceId: 1, usage5hPercent: 20, usageWeekPercent: 30 },
          { cpaInstanceId: 1, usage5hPercent: 40, usageWeekPercent: 50 },
          { cpaInstanceId: 2, usage5hPercent: 80, usageWeekPercent: 100 },
          { cpaInstanceId: 3, usage5hPercent: 0, usageWeekPercent: 0 },
        ],
        proxies: [
          { id: 1, enabled: true },
          { id: 2, enabled: true },
          { id: 3, enabled: false },
        ],
        proxyCpaInstances: [
          { proxyId: 1, cpaInstanceId: 1 },
          { proxyId: 1, cpaInstanceId: 2 },
          { proxyId: 2, cpaInstanceId: 2 },
          { proxyId: 3, cpaInstanceId: 1 },
        ],
      },
      [1, 2, 3],
    );

    expect(summary).toEqual({
      selectedCpaInstanceIds: [1, 2],
      accountCount: 3,
      availableAccountCount: 2,
      availableRate: 67,
      proxyCount: 2,
      average5hRemainingPercent: 45,
      averageWeekRemainingPercent: 30,
    });
  });
});

describe("buildDataBoardSeries", () => {
  it("builds trend points from the latest snapshot for each selected CPA at each time", () => {
    const series = buildDataBoardSeries(
      {
        cpaInstances: [
          { id: 1, name: "alpha", enabled: true },
          { id: 2, name: "beta", enabled: true },
          { id: 3, name: "gamma", enabled: true },
        ],
        snapshots: [
          {
            cpaInstanceId: 1,
            accountCount: 2,
            availableAccountCount: 1,
            average5hRemainingPercent: 80,
            averageWeekRemainingPercent: 70,
            proxyCount: 1,
            capturedAt: "2026-05-15T10:00:00.000Z",
          },
          {
            cpaInstanceId: 3,
            accountCount: 9,
            availableAccountCount: 9,
            average5hRemainingPercent: 10,
            averageWeekRemainingPercent: 10,
            proxyCount: 1,
            capturedAt: "2026-05-15T10:30:00.000Z",
          },
          {
            cpaInstanceId: 2,
            accountCount: 3,
            availableAccountCount: 3,
            average5hRemainingPercent: 60,
            averageWeekRemainingPercent: 40,
            proxyCount: 2,
            capturedAt: "2026-05-15T11:00:00.000Z",
          },
          {
            cpaInstanceId: 1,
            accountCount: 2,
            availableAccountCount: 2,
            average5hRemainingPercent: 90,
            averageWeekRemainingPercent: 80,
            proxyCount: 1,
            capturedAt: "2026-05-15T12:00:00.000Z",
          },
        ],
      },
      [1, 2],
    );

    expect(series).toEqual([
      {
        capturedAt: "2026-05-15T10:00:00.000Z",
        accountCount: 2,
        availableAccountCount: 1,
        availableRate: 50,
        proxyCount: 1,
        average5hRemainingPercent: 80,
        averageWeekRemainingPercent: 70,
      },
      {
        capturedAt: "2026-05-15T11:00:00.000Z",
        accountCount: 5,
        availableAccountCount: 4,
        availableRate: 80,
        proxyCount: 3,
        average5hRemainingPercent: 70,
        averageWeekRemainingPercent: 55,
      },
      {
        capturedAt: "2026-05-15T12:00:00.000Z",
        accountCount: 5,
        availableAccountCount: 5,
        availableRate: 100,
        proxyCount: 3,
        average5hRemainingPercent: 75,
        averageWeekRemainingPercent: 60,
      },
    ]);
  });
});

describe("limitDataBoardSeries", () => {
  it("aggregates long series down to the requested maximum points", () => {
    const series = Array.from({ length: 10 }, (_, index) => ({
      capturedAt: `2026-05-15T10:${String(index).padStart(2, "0")}:00.000Z`,
      accountCount: index,
      availableAccountCount: index,
      availableRate: index,
      proxyCount: index,
      average5hRemainingPercent: index,
      averageWeekRemainingPercent: index,
    }));

    expect(limitDataBoardSeries(series, 5)).toEqual([
      expect.objectContaining({ capturedAt: "2026-05-15T10:01:00.000Z", accountCount: 1 }),
      expect.objectContaining({ capturedAt: "2026-05-15T10:03:00.000Z", accountCount: 3 }),
      expect.objectContaining({ capturedAt: "2026-05-15T10:05:00.000Z", accountCount: 5 }),
      expect.objectContaining({ capturedAt: "2026-05-15T10:07:00.000Z", accountCount: 7 }),
      expect.objectContaining({ capturedAt: "2026-05-15T10:09:00.000Z", accountCount: 9 }),
    ]);
  });
});
