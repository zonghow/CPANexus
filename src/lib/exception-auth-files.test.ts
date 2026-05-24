import { describe, expect, it } from "vitest";

import {
  exceptionAuthFilesToEmailCsv,
  parseStoredAuthPayload,
  stringifyStoredAuthPayload,
} from "./exception-auth-files";

describe("exception auth file helpers", () => {
  it("exports one non-empty email per CSV line", () => {
    expect(
      exceptionAuthFilesToEmailCsv([
        { email: "first@example.com" },
        { email: "" },
        { email: null },
        { email: "second@example.com" },
      ]),
    ).toBe("first@example.com\nsecond@example.com\n");
  });

  it("escapes CSV email values that contain special characters", () => {
    expect(
      exceptionAuthFilesToEmailCsv([
        { email: "plain@example.com" },
        { email: "quoted,\"mail\"@example.com" },
      ]),
    ).toBe("plain@example.com\n\"quoted,\"\"mail\"\"@example.com\"\n");
  });

  it("stringifies and parses stored auth payloads", () => {
    const rawJson = stringifyStoredAuthPayload({ email: "a@example.com", token: "rt_test" });
    expect(parseStoredAuthPayload(rawJson)).toEqual({
      email: "a@example.com",
      token: "rt_test",
    });
  });

  it("rejects invalid stored auth payload json", () => {
    expect(() => parseStoredAuthPayload("{")).toThrow("stored auth payload is invalid");
  });
});
