import { describe, expect, it } from "vitest";

import { selectAvailableAuthFileIds } from "./auth-exchange-selection";

describe("selectAvailableAuthFileIds", () => {
  it("selects the first requested available auth file ids", () => {
    const rows = [
      { id: 1, disabled: false, quotaStatus: "available" },
      { id: 2, disabled: false, quotaStatus: "exception" },
      { id: 3, disabled: false, quotaStatus: "available" },
      { id: 4, disabled: true, quotaStatus: "available" },
      { id: 5, disabled: false, quotaStatus: "limited" },
      { id: 6, disabled: false, quotaStatus: "available" },
    ];

    expect(selectAvailableAuthFileIds(rows, 2)).toEqual([1, 3]);
  });

  it("caps selection at the number of available auth files", () => {
    const rows = [
      { id: 1, disabled: false, quotaStatus: "exception" },
      { id: 2, disabled: false, quotaStatus: "available" },
      { id: 3, disabled: true, quotaStatus: "available" },
    ];

    expect(selectAvailableAuthFileIds(rows, 10)).toEqual([2]);
  });
});
