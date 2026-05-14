import { describe, expect, it } from "vitest";

import { onlyEnabledCpaGroups } from "./cpa-groups";

describe("onlyEnabledCpaGroups", () => {
  it("keeps only groups whose CPA instance is enabled", () => {
    const groups = [
      { instance: { id: 1, enabled: true }, value: "shown" },
      { instance: { id: 2, enabled: false }, value: "hidden" },
      { instance: { id: 3, enabled: true }, value: "also shown" },
    ];

    expect(onlyEnabledCpaGroups(groups).map((group) => group.value)).toEqual([
      "shown",
      "also shown",
    ]);
  });
});
