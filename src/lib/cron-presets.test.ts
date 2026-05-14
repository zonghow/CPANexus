import { describe, expect, it } from "vitest";

import {
  cronToSimpleSchedule,
  describeSimpleSchedule,
  simpleScheduleToCron,
} from "./cron-presets";

describe("cronToSimpleSchedule", () => {
  it("parses minute interval schedules", () => {
    expect(cronToSimpleSchedule("*/10 * * * *")).toEqual({
      mode: "interval",
      everyMinutes: 10,
    });
  });

  it("parses hourly schedules", () => {
    expect(cronToSimpleSchedule("5 * * * *")).toEqual({
      mode: "hourly",
      minute: 5,
    });
  });

  it("parses daily schedules", () => {
    expect(cronToSimpleSchedule("30 3 * * *")).toEqual({
      mode: "daily",
      time: "03:30",
    });
  });

  it("parses weekly schedules and normalizes Sunday", () => {
    expect(cronToSimpleSchedule("15 8 * * 7")).toEqual({
      mode: "weekly",
      dayOfWeek: 0,
      time: "08:15",
    });
  });

  it("keeps unrecognized cron expressions in advanced mode", () => {
    expect(cronToSimpleSchedule("15,45 8-10 * * *")).toEqual({
      mode: "advanced",
      cron: "15,45 8-10 * * *",
    });
  });
});

describe("simpleScheduleToCron", () => {
  it("formats friendly schedules back to cron expressions", () => {
    expect(simpleScheduleToCron({ mode: "interval", everyMinutes: 15 })).toBe("*/15 * * * *");
    expect(simpleScheduleToCron({ mode: "hourly", minute: 0 })).toBe("0 * * * *");
    expect(simpleScheduleToCron({ mode: "daily", time: "21:05" })).toBe("5 21 * * *");
    expect(simpleScheduleToCron({ mode: "weekly", dayOfWeek: 1, time: "06:30" })).toBe("30 6 * * 1");
    expect(simpleScheduleToCron({ mode: "advanced", cron: "15,45 8-10 * * *" })).toBe("15,45 8-10 * * *");
  });
});

describe("describeSimpleSchedule", () => {
  it("describes schedules in compact Chinese labels", () => {
    expect(describeSimpleSchedule({ mode: "interval", everyMinutes: 10 })).toBe("每 10 分钟执行一次");
    expect(describeSimpleSchedule({ mode: "hourly", minute: 5 })).toBe("每小时第 5 分钟执行");
    expect(describeSimpleSchedule({ mode: "daily", time: "03:30" })).toBe("每天 03:30 执行");
    expect(describeSimpleSchedule({ mode: "weekly", dayOfWeek: 1, time: "06:30" })).toBe("每周一 06:30 执行");
    expect(describeSimpleSchedule({ mode: "advanced", cron: "15,45 8-10 * * *" })).toBe("高级 Cron：15,45 8-10 * * *");
  });
});
