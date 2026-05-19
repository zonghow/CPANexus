import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  uploadRemoteAuthFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/cpa-instances/[id]/auth-json", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-auth-json-route-"));
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

  it("uploads selected CPA JSON files and syncs the requested CPA once", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced 2 auth files, 2 quota snapshots",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-json", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          files: [
            {
              fileName: "codex-a@example.com-auto.json",
              payload: {
                type: "codex",
                email: "a@example.com",
                refresh_token: "rt_a",
              },
            },
            {
              fileName: "custom-b.json",
              payload: {
                provider: "codex",
                email: "b@example.com",
                refresh_token: "rt_b",
              },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 2,
      failed: 0,
      results: [
        { fileName: "codex-a@example.com-auto.json", email: "a@example.com", status: "success" },
        { fileName: "custom-b.json", email: "b@example.com", status: "success" },
      ],
    });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledTimes(2);
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-a@example.com-auto.json",
      expect.objectContaining({ refresh_token: "rt_a" }),
    );
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "custom-b.json",
      expect.objectContaining({ refresh_token: "rt_b" }),
    );
    expect(
      sqlite
        .prepare("SELECT file_name, email, provider FROM auth_files ORDER BY file_name")
        .all(),
    ).toEqual([
      {
        file_name: "codex-a@example.com-auto.json",
        email: "a@example.com",
        provider: "codex",
      },
      {
        file_name: "custom-b.json",
        email: "b@example.com",
        provider: "codex",
      },
    ]);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
  });

  it("converts sub2api exported OpenAI OAuth accounts before uploading and syncs once", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-json", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          files: [
            {
              fileName: "sub2api-account-export.json",
              payload: {
                exported_at: "2026-05-17T00:00:00Z",
                proxies: [],
                accounts: [
                  {
                    name: "sub account",
                    platform: "openai",
                    type: "oauth",
                    credentials: {
                      access_token: "access_a",
                      refresh_token: "rt_sub_a",
                      id_token: "id_a",
                      email: "sub-a@example.com",
                      chatgpt_account_id: "account-a",
                      plan_type: "pro",
                      expires_at: "2026-05-17T01:00:00Z",
                      client_id: "client-a",
                    },
                    extra: { note: "kept out of CPA auth payload" },
                    concurrency: 3,
                    priority: 50,
                  },
                  {
                    name: "Anthropic account",
                    platform: "anthropic",
                    type: "oauth",
                    credentials: {
                      refresh_token: "rt_claude",
                      email: "claude@example.com",
                    },
                    concurrency: 3,
                    priority: 50,
                  },
                  {
                    name: "Sub B",
                    platform: "openai",
                    type: "oauth",
                    credentials: {
                      refresh_token: "rt_sub_b",
                      email: "sub-b@example.com",
                    },
                    concurrency: 3,
                    priority: 50,
                  },
                ],
              },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 2,
      failed: 0,
      results: [
        { fileName: "codex-sub-a@example.com-auto.json", email: "sub-a@example.com", status: "success" },
        { fileName: "codex-sub-b@example.com-auto.json", email: "sub-b@example.com", status: "success" },
      ],
    });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledTimes(2);
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-sub-a@example.com-auto.json",
      {
        access_token: "access_a",
        account_id: "account-a",
        client_id: "client-a",
        disabled: false,
        email: "sub-a@example.com",
        expired: "2026-05-17T01:00:00Z",
        id_token: "id_a",
        refresh_token: "rt_sub_a",
        type: "codex",
      },
    );
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: cpaInstanceId }),
      "codex-sub-b@example.com-auto.json",
      {
        disabled: false,
        email: "sub-b@example.com",
        expired: "1970-01-01T00:00:00Z",
        refresh_token: "rt_sub_b",
        type: "codex",
      },
    );
    expect(
      sqlite
        .prepare("SELECT file_name, email, provider FROM auth_files ORDER BY file_name")
        .all(),
    ).toEqual([
      {
        file_name: "codex-sub-a@example.com-auto.json",
        email: "sub-a@example.com",
        provider: "codex",
      },
      {
        file_name: "codex-sub-b@example.com-auto.json",
        email: "sub-b@example.com",
        provider: "codex",
      },
    ]);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
  });

  it("converts ChatGPT session JSON to CPA auth JSON before uploading", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-json", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          source: "session-json",
          files: [
            {
              fileName: "session.json",
              payload: {
                user: {
                  id: "user-test",
                  email: "session@example.com",
                },
                expires: "2026-08-06T14:29:36.155Z",
                account: {
                  id: "00000000-0000-4000-9000-000000000000",
                  planType: "plus",
                },
                accessToken: "access-token",
                sessionToken: "session-token",
              },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: 1,
      failed: 0,
      results: [
        {
          fileName: "codex-session@example.com-auto.json",
          email: "session@example.com",
          status: "success",
        },
      ],
    });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledTimes(1);
    const [, fileName, payload] = vi.mocked(cpaClient.uploadRemoteAuthFile).mock.calls[0] ?? [];
    expect(fileName).toBe("codex-session@example.com-auto.json");
    expect(payload).toMatchObject({
      type: "codex",
      account_id: "00000000-0000-4000-9000-000000000000",
      chatgpt_account_id: "00000000-0000-4000-9000-000000000000",
      email: "session@example.com",
      name: "session@example.com",
      plan_type: "plus",
      chatgpt_plan_type: "plus",
      access_token: "access-token",
      refresh_token: "",
      session_token: "session-token",
      expired: "2026-08-06T14:29:36.155Z",
      id_token_synthetic: true,
    });
    expect((payload as Record<string, unknown>).id_token).toEqual(expect.stringMatching(/^[^.]+\.[^.]+\.synthetic$/));
    expect(
      sqlite
        .prepare("SELECT file_name, email, provider FROM auth_files ORDER BY file_name")
        .all(),
    ).toEqual([
      {
        file_name: "codex-session@example.com-auto.json",
        email: "session@example.com",
        provider: "codex",
      },
    ]);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(cpaInstanceId);
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

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}
