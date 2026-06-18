import { describe, expect, it } from "vitest";

import { sortAccountRows, type AccountSortRow } from "./account-sort";

describe("sortAccountRows", () => {
  it("sorts accounts by subscription tier before account name", () => {
    const rows = [
      { fileName: "z-free.json", email: "z-free@example.com", subscriptionType: "free" },
      { fileName: "b-plus.json", email: "b-plus@example.com", subscriptionType: "plus" },
      { fileName: "c-pro5.json", email: "c-pro5@example.com", subscriptionType: "pro_lite" },
      { fileName: "b-pro20.json", email: "b-pro20@example.com", subscriptionType: "pro" },
      { fileName: "a-pro20.json", email: "a-pro20@example.com", subscriptionType: "pro20x" },
      { fileName: "a-team.json", email: "a-team@example.com", subscriptionType: "team" },
      { fileName: "a-plus.json", email: "a-plus@example.com", subscriptionType: "plus" },
    ];

    expect(sortAccountRows(rows).map((row) => row.email)).toEqual([
      "a-pro20@example.com",
      "b-pro20@example.com",
      "c-pro5@example.com",
      "a-team@example.com",
      "a-plus@example.com",
      "b-plus@example.com",
      "z-free@example.com",
    ]);
  });

  it("falls back to file name when email is missing", () => {
    const rows = [
      { fileName: "b.json", email: null, subscriptionType: "plus" },
      { fileName: "a.json", email: null, subscriptionType: "plus" },
    ];

    expect(sortAccountRows(rows).map((row) => row.fileName)).toEqual(["a.json", "b.json"]);
  });

  it("always pushes limited, disabled, and exception accounts to the end", () => {
    const rows: AccountSortRow[] = [
      { email: "z-normal-free@example.com", subscriptionType: "free", quotaStatus: "available" },
      { email: "a-limited-pro@example.com", subscriptionType: "pro", quotaStatus: "limited" },
      { email: "a-normal-plus@example.com", subscriptionType: "plus", quotaStatus: "available" },
      { email: "a-exception-pro@example.com", subscriptionType: "pro", quotaStatus: "exception" },
      { email: "a-disabled-pro@example.com", subscriptionType: "pro", quotaStatus: "disabled" },
      { email: "a-normal-pro@example.com", subscriptionType: "pro", quotaStatus: "available" },
    ];

    expect(sortAccountRows(rows).map((row) => row.email)).toEqual([
      "a-normal-pro@example.com",
      "a-normal-plus@example.com",
      "z-normal-free@example.com",
      "a-limited-pro@example.com",
      "a-disabled-pro@example.com",
      "a-exception-pro@example.com",
    ]);
  });
});
