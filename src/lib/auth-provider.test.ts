import { describe, expect, it } from "vitest";

import {
  accountTypeFromAuthPayload,
  matchesAuthView,
  resolveAuthView,
  sectionAllowedForAuthView,
} from "./auth-provider";

describe("auth-provider", () => {
  it("resolves codex and grok provider aliases", () => {
    expect(resolveAuthView("codex")).toBe("codex");
    expect(resolveAuthView("openai")).toBe("codex");
    expect(resolveAuthView("xai")).toBe("grok");
    expect(resolveAuthView("grok")).toBe("grok");
    expect(resolveAuthView("claude")).toBeNull();
  });

  it("treats missing provider as codex when matching", () => {
    expect(matchesAuthView(null, "codex")).toBe(true);
    expect(matchesAuthView(undefined, "codex")).toBe(true);
    expect(matchesAuthView("", "codex")).toBe(true);
    expect(matchesAuthView(null, "grok")).toBe(false);
    expect(matchesAuthView("xai", "grok")).toBe(true);
    expect(matchesAuthView("xai", "codex")).toBe(false);
  });

  it("restricts grok sections", () => {
    expect(sectionAllowedForAuthView("auth", "grok")).toBe(true);
    expect(sectionAllowedForAuthView("instances", "grok")).toBe(true);
    expect(sectionAllowedForAuthView("proxies", "grok")).toBe(true);
    expect(sectionAllowedForAuthView("jobs", "grok")).toBe(true);
    expect(sectionAllowedForAuthView("dashboard", "grok")).toBe(false);
    expect(sectionAllowedForAuthView("candidate-pool", "grok")).toBe(false);
  });

  it("extracts grok account type from payload", () => {
    expect(accountTypeFromAuthPayload({ auth_kind: "oauth" })).toBe("oauth");
    expect(accountTypeFromAuthPayload({ api_key: "xai-xxx" })).toBe("api_key");
    expect(
      accountTypeFromAuthPayload({
        type: "xai",
        access_token: "token",
        refresh_token: "rt",
      }),
    ).toBe("oauth");
  });
});
