import { describe, expect, it, vi } from "vitest";

import {
  buildRtLoginAuth,
  openAiMobileRtClientId,
  parseRtLoginLines,
  refreshOpenAiToken,
} from "./rt-login";

describe("parseRtLoginLines", () => {
  it("accepts dashed credential rows and raw token rows", () => {
    const result = parseRtLoginLines([
      "person@example.com----password----x----rt_dash_token",
      "plain_refresh_token_without_rt_prefix",
      "other@example.com----password----x----plain_dashed_token",
    ].join("\n"));

    expect(result.invalid).toEqual([]);
    expect(result.valid).toEqual([
      {
        lineNumber: 1,
        sourceLine: "person@example.com----password----x----rt_dash_token",
        email: "person@example.com",
        refreshToken: "rt_dash_token",
      },
      {
        lineNumber: 2,
        sourceLine: "plain_refresh_token_without_rt_prefix",
        email: null,
        refreshToken: "plain_refresh_token_without_rt_prefix",
      },
      {
        lineNumber: 3,
        sourceLine: "other@example.com----password----x----plain_dashed_token",
        email: "other@example.com",
        refreshToken: "plain_dashed_token",
      },
    ]);
  });

  it("reports incomplete dashed rows without a refresh token", () => {
    const result = parseRtLoginLines("bad@example.com----password\nnot a token");

    expect(result.valid).toEqual([
      {
        lineNumber: 2,
        sourceLine: "not a token",
        email: null,
        refreshToken: "not a token",
      },
    ]);
    expect(result.invalid).toEqual([
      {
        lineNumber: 1,
        sourceLine: "bad@example.com----password",
        reason: "missing refresh token",
      },
    ]);
  });
});

describe("buildRtLoginAuth", () => {
  it("builds CPA auth JSON from refreshed OpenAI tokens", () => {
    const result = buildRtLoginAuth(
      {
        lineNumber: 1,
        sourceLine: "rt_only_token",
        email: null,
        refreshToken: "rt_only_token",
      },
      {
        access_token: "access-token",
        refresh_token: "rt_new_token",
        id_token: jwtPayload({
          email: "from-id-token@example.com",
          sub: "sub-123",
          exp: 2_000,
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account-123",
            chatgpt_plan_type: "pro",
          },
        }),
        expires_in: 600,
      },
      {
        now: new Date("2026-05-16T10:00:00Z"),
        clientId: openAiMobileRtClientId,
      },
    );

    expect(result).toEqual({
      email: "from-id-token@example.com",
      fileName: "codex-from-id-token@example.com-auto.json",
      planType: "pro",
      payload: {
        access_token: "access-token",
        account_id: "account-123",
        client_id: openAiMobileRtClientId,
        disabled: false,
        email: "from-id-token@example.com",
        expired: "2026-05-16T10:10:00Z",
        id_token: expect.any(String),
        last_refresh: "2026-05-16T10:00:00Z",
        refresh_token: "rt_new_token",
        type: "codex",
      },
      refreshToken: "rt_new_token",
      sourceLine: "rt_only_token",
    });
  });
});

describe("refreshOpenAiToken", () => {
  it("posts refresh_token grant with the requested client_id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ access_token: "access", id_token: "id", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await refreshOpenAiToken("rt_mobile", {
      clientId: openAiMobileRtClientId,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({ access_token: "access", id_token: "id" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain(`client_id=${encodeURIComponent(openAiMobileRtClientId)}`);
    expect(init?.body).toContain("grant_type=refresh_token");
    expect(init?.body).toContain("scope=openid+profile+email");
  });

  it("uses a proxy dispatcher when proxyUrl is provided", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ access_token: "access", id_token: "id", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await refreshOpenAiToken("rt_proxy", {
      fetchImpl: fetchMock,
      proxyUrl: "http://proxy.example.com:8080",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit & { dispatcher?: unknown })?.dispatcher).toBeTruthy();
  });
});

function jwtPayload(payload: Record<string, unknown>) {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
