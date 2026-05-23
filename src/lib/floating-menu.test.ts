import { describe, expect, it } from "vitest";

import { getFloatingMenuPosition } from "./floating-menu";

describe("getFloatingMenuPosition", () => {
  it("opens below the trigger when there is enough viewport space", () => {
    expect(
      getFloatingMenuPosition(
        { left: 520, right: 560, top: 100, bottom: 128 },
        { menuWidth: 160, menuHeight: 180, viewportWidth: 800, viewportHeight: 640 },
      ),
    ).toEqual({ left: 400, top: 134 });
  });

  it("opens above the trigger and clamps horizontally near viewport edges", () => {
    expect(
      getFloatingMenuPosition(
        { left: 20, right: 56, top: 520, bottom: 552 },
        { menuWidth: 160, menuHeight: 180, viewportWidth: 320, viewportHeight: 600 },
      ),
    ).toEqual({ left: 8, top: 334 });
  });
});
