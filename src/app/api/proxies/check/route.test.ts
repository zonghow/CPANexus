import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/proxy-check", () => ({
  checkProxyUrl: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/proxies/check", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-proxy-check-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("checks every configured proxy and returns per-proxy results", async () => {
    const { migrate } = await import("@/db/migrate");
    const { getSqlite } = await import("@/db/client");
    const { checkProxyUrl } = await import("@/lib/proxy-check");
    migrate();
    const sqlite = getSqlite();
    sqlite
      .prepare(`
        INSERT INTO proxies (name, url, max_auth_files, enabled)
        VALUES
          ('proxy-a', 'http://proxy-a.example.com:8080', 10, 1),
          ('proxy-b', 'socks5://proxy-b.example.com:1080', 10, 0)
      `)
      .run();
    vi.mocked(checkProxyUrl)
      .mockResolvedValueOnce({ ok: true, latencyMs: 42, message: "可连接" })
      .mockResolvedValueOnce({ ok: false, latencyMs: null, message: "连接被拒绝" });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/proxies/check", {
        method: "POST",
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      results: Array<{ proxyId: number; ok: boolean; latencyMs: number | null; message: string }>;
    };
    expect(checkProxyUrl).toHaveBeenCalledWith("http://proxy-a.example.com:8080");
    expect(checkProxyUrl).toHaveBeenCalledWith("socks5://proxy-b.example.com:1080");
    expect(payload.results).toEqual([
      expect.objectContaining({ proxyId: 1, ok: true, latencyMs: 42, message: "可连接" }),
      expect.objectContaining({ proxyId: 2, ok: false, latencyMs: null, message: "连接被拒绝" }),
    ]);
  });
});

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: {
      close: () => void;
    };
  };
}
