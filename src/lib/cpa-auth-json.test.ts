import { describe, expect, it } from "vitest";

import { expandCpaAuthJsonFile } from "./cpa-auth-json";

describe("expandCpaAuthJsonFile", () => {
  it("keeps CPA auth JSON payloads unchanged", () => {
    const result = expandCpaAuthJsonFile({
      fileName: "codex-user@example.com-auto.json",
      payload: {
        type: "codex",
        email: "user@example.com",
        refresh_token: "rt_user",
      },
    });

    expect(result).toEqual([
      {
        kind: "file",
        file: {
          fileName: "codex-user@example.com-auto.json",
          payload: {
            type: "codex",
            email: "user@example.com",
            refresh_token: "rt_user",
          },
          email: "user@example.com",
          provider: "codex",
          proxyUrl: null,
        },
      },
    ]);
  });

  it("converts supported sub2api OpenAI OAuth accounts to CPA auth JSON", () => {
    const result = expandCpaAuthJsonFile({
      fileName: "sub2api.json",
      payload: {
        accounts: [
          {
            name: "primary",
            platform: "openai",
            type: "oauth",
            credentials: {
              email: "sub@example.com",
              refresh_token: "rt_sub",
              access_token: "access_sub",
              chatgpt_account_id: "account-sub",
              expires_at: "2026-05-17T01:00:00Z",
            },
          },
          {
            platform: "anthropic",
            type: "oauth",
            credentials: {
              email: "ignored@example.com",
              refresh_token: "rt_ignored",
            },
          },
        ],
      },
    });

    expect(result).toEqual([
      {
        kind: "file",
        file: {
          fileName: "codex-sub@example.com-auto.json",
          email: "sub@example.com",
          provider: "codex",
          proxyUrl: null,
          payload: {
            disabled: false,
            email: "sub@example.com",
            expired: "2026-05-17T01:00:00Z",
            refresh_token: "rt_sub",
            type: "codex",
            access_token: "access_sub",
            account_id: "account-sub",
          },
        },
      },
    ]);
  });
});
