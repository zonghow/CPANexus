import { describe, expect, it } from "vitest";

import {
  buildAutoAuthFileName,
  buildCodexAuthPayload,
  parseBackupAccountLines,
} from "./replacement-accounts";

describe("parseBackupAccountLines", () => {
  it("extracts email and refresh token from dashed backup account lines", () => {
    const text = [
      "first.backup@example.com----password----x----rt_testRefreshTokenAlpha_123",
      "second.backup@example.net----password----rt_testRefreshTokenBeta_456----tok_testAccessToken",
    ].join("\n");

    const result = parseBackupAccountLines(text);

    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0]).toMatchObject({
      email: "first.backup@example.com",
      refreshToken: "rt_testRefreshTokenAlpha_123",
      sourceLine: text.split("\n")[0],
    });
    expect(result.valid[1].email).toBe("second.backup@example.net");
    expect(result.valid[1].refreshToken).toBe("rt_testRefreshTokenBeta_456");
  });

  it("reports lines that do not contain both email and refresh token", () => {
    const result = parseBackupAccountLines("missing-token@example.com----password\nrt_only_without_email");

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toEqual([
      {
        lineNumber: 1,
        sourceLine: "missing-token@example.com----password",
        reason: "missing refresh token",
      },
      {
        lineNumber: 2,
        sourceLine: "rt_only_without_email",
        reason: "missing email",
      },
    ]);
  });
});

describe("buildCodexAuthPayload", () => {
  it("creates the CPA codex auth JSON shape", () => {
    expect(
      buildCodexAuthPayload({
        email: "person@example.com",
        refreshToken: "rt_example",
      }),
    ).toEqual({
      type: "codex",
      refresh_token: "rt_example",
      expired: "1970-01-01T00:00:00Z",
      email: "person@example.com",
    });
  });
});

describe("buildAutoAuthFileName", () => {
  it("uses the requested codex email auto filename format", () => {
    expect(buildAutoAuthFileName("person@example.com")).toBe(
      "codex-person@example.com-auto.json",
    );
  });

  it("sanitizes path separators and unsafe filename characters", () => {
    expect(buildAutoAuthFileName("../bad/user@example.com")).toBe(
      "codex-bad_user@example.com-auto.json",
    );
  });
});
