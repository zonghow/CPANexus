import { describe, expect, it } from "vitest";

import { nextCronRunAfter, secondsUntilCronRun } from "./cron-next-run";

describe("nextCronRunAfter", () => {
  it("calculates the next run for minute interval cron expressions", () => {
    const next = nextCronRunAfter(
      "*/10 * * * *",
      new Date("2026-05-14T06:51:30.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-05-14T07:00:00.000Z");
  });

  it("calculates the next run for lists and ranges", () => {
    const expected = new Date(2026, 4, 14, 8, 45, 0, 0);
    const next = nextCronRunAfter(
      "15,45 8-10 * * *",
      new Date(2026, 4, 14, 8, 16, 0, 0),
    );

    expect(next?.getTime()).toBe(expected.getTime());
  });

  it("returns null for invalid cron expressions", () => {
    expect(nextCronRunAfter("not a cron", new Date("2026-05-14T08:16:00.000Z"))).toBeNull();
  });
});

describe("secondsUntilCronRun", () => {
  it("rounds up positive seconds until the next run", () => {
    expect(
      secondsUntilCronRun("*/10 * * * *", new Date("2026-05-14T06:59:01.500Z")),
    ).toBe(59);
  });
});
