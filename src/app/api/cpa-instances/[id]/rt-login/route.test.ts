import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";
import { openAiMobileRtClientId } from "@/lib/rt-login";

vi.mock("@/lib/cpa-client", () => ({
  uploadRemoteAuthFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/cpa-instances/[id]/rt-login", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-rt-login-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("logs in a Mobile RT row and uploads the successful auth payload", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const idToken = jwtPayload({
      email: "mobile@example.com",
      sub: "sub-mobile",
      exp: 2_000,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-mobile",
        chatgpt_plan_type: "plus",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain(`client_id=${encodeURIComponent(openAiMobileRtClientId)}`);
      return new Response(JSON.stringify({
        access_token: "access-mobile",
        refresh_token: "rt_mobile_new",
        id_token: idToken,
        expires_in: 600,
      }));
    }));
    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    const jobs = await import("@/lib/jobs");
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced 1 auth files, 1 quota snapshots",
    });
    const route = await import("./route");

    const loginResponse = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/rt-login", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "login",
          mode: "mobile_rt",
          line: "rt_mobile_old",
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(loginResponse.status).toBe(200);
    const loggedIn = await loginResponse.json();
    expect(loggedIn).toMatchObject({
      email: "mobile@example.com",
      fileName: "codex-mobile@example.com-auto.json",
      planType: "plus",
      refreshToken: "rt_mobile_new",
      payload: {
        access_token: "access-mobile",
        account_id: "account-mobile",
        client_id: openAiMobileRtClientId,
        email: "mobile@example.com",
        refresh_token: "rt_mobile_new",
        type: "codex",
      },
    });

    const uploadResponse = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/rt-login", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "upload",
          mode: "mobile_rt",
          entries: [loggedIn],
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(uploadResponse.status).toBe(200);
    await expect(uploadResponse.json()).resolves.toMatchObject({ uploaded: 1 });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-mobile@example.com-auto.json",
      expect.objectContaining({ client_id: openAiMobileRtClientId }),
    );
    expect(sqlite.prepare("SELECT email, file_name, raw_json FROM auth_files").get()).toMatchObject({
      email: "mobile@example.com",
      file_name: "codex-mobile@example.com-auto.json",
    });
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
  });

  it("logs in through an enabled proxy even when the proxy is not linked to the CPA", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const proxyId = insertProxy(sqlite, { enabled: true });
    const idToken = jwtPayload({
      email: "proxy@example.com",
      sub: "sub-proxy",
      exp: 2_000,
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeTruthy();
      return new Response(JSON.stringify({
        access_token: "access-proxy",
        refresh_token: "rt_proxy_new",
        id_token: idToken,
        expires_in: 600,
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/rt-login", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "login",
          mode: "rt",
          line: "rt_proxy_old",
          proxyId,
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: "proxy@example.com",
      refreshToken: "rt_proxy_new",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects disabled proxies for RT login", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const proxyId = insertProxy(sqlite, { enabled: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/rt-login", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "login",
          mode: "rt",
          line: "rt_proxy_old",
          proxyId,
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("代理不可用"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES ('target', 'https://target.example.com', 'secret', '/v0/management/auth-files', 1)
    `)
    .run();
  return Number(result.lastInsertRowid);
}

function insertProxy(
  sqlite: Database.Database,
  input: { enabled: boolean },
) {
  const result = sqlite
    .prepare(`
      INSERT INTO proxies (name, url, max_auth_files, enabled)
      VALUES ('proxy-a', 'http://proxy.example.com:8080', 10, ?)
    `)
    .run(input.enabled ? 1 : 0);
  return Number(result.lastInsertRowid);
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

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
