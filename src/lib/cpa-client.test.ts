import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteRemoteAuthFile,
  patchRemoteAuthFileFields,
  refreshRemoteQuotas,
  setRemoteAuthFileDisabled,
  startCodexOAuth,
  submitCodexOAuthCallback,
  uploadRemoteAuthFile,
} from "./cpa-client";

const instance = {
  id: 1,
  name: "demo",
  baseUrl: "https://cpa.example.com/",
  password: "secret",
  quotaRefreshPath: "/v0/management/auth-files",
};

describe("refreshRemoteQuotas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses CPA api-call to refresh Codex wham usage for auth-file defaults", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://cpa.example.com/v0/management/auth-files") {
        return jsonResponse({
          files: [
            {
              name: "codex-a@example.com-auto.json",
              email: "a@example.com",
              auth_index: "auth-a",
              id_token: { chatgpt_account_id: "acct-a" },
            },
          ],
        });
      }

      if (url === "https://cpa.example.com/v0/management/api-call") {
        const body = JSON.parse(String(init?.body)) as {
          auth_index: string;
          method: string;
          url: string;
          header: Record<string, string>;
        };
        expect(body).toMatchObject({
          auth_index: "auth-a",
          method: "GET",
          url: "https://chatgpt.com/backend-api/wham/usage",
          header: {
            Authorization: "Bearer $TOKEN$",
            "chatgpt-account-id": "acct-a",
          },
        });

        return jsonResponse({
          status_code: 200,
          body: JSON.stringify({
            email: "a@example.com",
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: {
                used_percent: 21,
                limit_window_seconds: 18_000,
              },
              secondary_window: {
                used_percent: 64,
                limit_window_seconds: 604_800,
              },
            },
          }),
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const snapshots = await refreshRemoteQuotas(instance);

    expect(snapshots).toMatchObject([
      {
        email: "a@example.com",
        authFileName: "codex-a@example.com-auto.json",
        usage5hPercent: 21,
        usageWeekPercent: 64,
        available: true,
        exception: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes Codex wham usage without an account id like CPA management", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://cpa.example.com/v0/management/api-call") {
        const body = JSON.parse(String(init?.body)) as {
          auth_index: string;
          method: string;
          url: string;
          header: Record<string, string>;
        };
        expect(body).toMatchObject({
          auth_index: "auth-legacy",
          method: "GET",
          url: "https://chatgpt.com/backend-api/wham/usage",
          header: {
            Authorization: "Bearer $TOKEN$",
          },
        });
        expect(body.header).not.toHaveProperty("chatgpt-account-id");
        expect(body.header).not.toHaveProperty("Chatgpt-Account-Id");

        return jsonResponse({
          status_code: 200,
          body: JSON.stringify({
            email: "legacy@example.com",
            plan_type: "plus",
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: {
                used_percent: 18,
                limit_window_seconds: 18_000,
              },
              secondary_window: {
                used_percent: 3,
                limit_window_seconds: 604_800,
              },
            },
          }),
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const snapshots = await refreshRemoteQuotas(instance, [
      {
        name: "G_13906279182-1.json",
        auth_index: "auth-legacy",
        type: "codex",
      },
    ]);

    expect(snapshots).toMatchObject([
      {
        email: "legacy@example.com",
        authFileName: "G_13906279182-1.json",
        usage5hPercent: 18,
        usageWeekPercent: 3,
        available: true,
        exception: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("deleteRemoteAuthFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the CPA auth-file delete endpoint with management auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://cpa.example.com/v0/management/auth-files?name=codex-a%40example.com-auto.json",
      );
      expect(init?.method).toBe("DELETE");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
      });
      return jsonResponse({ status: "ok" });
    });

    vi.stubGlobal("fetch", fetchMock);

    await deleteRemoteAuthFile(instance, "codex-a@example.com-auto.json");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("uploadRemoteAuthFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the CPA auth-file upload endpoint with the file name query and JSON body", async () => {
    const payload = {
      type: "codex",
      refresh_token: "rt_test",
      expired: "1970-01-01T00:00:00Z",
      email: "a@example.com",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://cpa.example.com/v0/management/auth-files?name=codex-a%40example.com-auto.json",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      return jsonResponse({ status: "ok" });
    });

    vi.stubGlobal("fetch", fetchMock);

    await uploadRemoteAuthFile(instance, "codex-a@example.com-auto.json", payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("patchRemoteAuthFileFields", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates editable auth-file fields through the CPA fields endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://cpa.example.com/v0/management/auth-files/fields");
      expect(init?.method).toBe("PATCH");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "codex-a@example.com-auto.json",
        proxy_url: "http://proxy.example.com",
        note: "uploaded by CPA Nexus",
      });
      return jsonResponse({ status: "ok" });
    });

    vi.stubGlobal("fetch", fetchMock);

    await patchRemoteAuthFileFields(instance, "codex-a@example.com-auto.json", {
      proxy_url: "http://proxy.example.com",
      note: "uploaded by CPA Nexus",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("setRemoteAuthFileDisabled", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggles an auth file through the CPA status endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://cpa.example.com/v0/management/auth-files/status");
      expect(init?.method).toBe("PATCH");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "codex-a@example.com-auto.json",
        disabled: true,
      });
      return jsonResponse({ status: "ok", disabled: true });
    });

    vi.stubGlobal("fetch", fetchMock);

    await setRemoteAuthFileDisabled(instance, "codex-a@example.com-auto.json", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("startCodexOAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a Codex WebUI OAuth login URL from the CPA management API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://cpa.example.com/v0/management/codex-auth-url?is_webui=true",
      );
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
      });
      return jsonResponse({
        auth_url: "https://auth.example.com/start",
        state: "oauth-state",
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(startCodexOAuth(instance)).resolves.toEqual({
      authUrl: "https://auth.example.com/start",
      state: "oauth-state",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts CPA OAuth responses that use url instead of auth_url", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        url: "https://auth.example.com/url-field",
        state: "oauth-state",
        status: "ok",
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(startCodexOAuth(instance)).resolves.toEqual({
      authUrl: "https://auth.example.com/url-field",
      state: "oauth-state",
    });
  });
});

describe("submitCodexOAuthCallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the pasted Codex OAuth callback URL to the CPA management API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://cpa.example.com/v0/management/oauth-callback");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: "codex",
        redirect_url: "https://callback.example.com/?code=abc&state=oauth-state",
      });
      return jsonResponse({ success: true });
    });

    vi.stubGlobal("fetch", fetchMock);

    await submitCodexOAuthCallback(
      instance,
      "https://callback.example.com/?code=abc&state=oauth-state",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces callback errors returned by CPA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: "invalid code" })),
    );

    await expect(
      submitCodexOAuthCallback(instance, "https://callback.example.com/?code=bad"),
    ).rejects.toThrow("invalid code");
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
