import { describe, expect, it } from "vitest";

import { loadAppConfigFromToml } from "./config";

describe("loadAppConfigFromToml", () => {
  it("loads auth settings from config.toml content", () => {
    const config = loadAppConfigFromToml(`
      [auth]
      admin_password = "secret-pass"
      cookie_name = "custom_session"
      session_max_age_days = 3
    `);

    expect(config.auth).toEqual({
      adminPassword: "secret-pass",
      cookieName: "custom_session",
      sessionMaxAgeDays: 3,
    });
  });

  it("keeps safe defaults for omitted optional auth settings", () => {
    const config = loadAppConfigFromToml(`
      [auth]
      admin_password = "secret-pass"
    `);

    expect(config.auth).toMatchObject({
      adminPassword: "secret-pass",
      cookieName: "cpa_nexus_session",
      sessionMaxAgeDays: 7,
    });
  });
});
