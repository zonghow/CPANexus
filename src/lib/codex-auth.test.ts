import { describe, expect, it } from "vitest";

import { buildAutoAuthFileName } from "./codex-auth";

describe("buildAutoAuthFileName", () => {
  it("uses codex auto auth file naming", () => {
    expect(buildAutoAuthFileName("person@example.com")).toBe(
      "codex-person@example.com-auto.json",
    );
  });

  it("sanitizes path-like email input", () => {
    expect(buildAutoAuthFileName("../bad/user@example.com")).toBe(
      "codex-bad_user@example.com-auto.json",
    );
  });
});
