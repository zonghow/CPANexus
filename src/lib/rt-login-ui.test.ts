import { describe, expect, it } from "vitest";

import { defaultRtLoginProxyMode } from "./rt-login-ui";

describe("defaultRtLoginProxyMode", () => {
  it("defaults to proxy pool when enabled proxies exist", () => {
    expect(defaultRtLoginProxyMode(1)).toBe("pool");
  });

  it("falls back to direct login when no proxy is enabled", () => {
    expect(defaultRtLoginProxyMode(0)).toBe("none");
  });
});
