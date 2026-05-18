import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/message-push-policies/[id]/test", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-message-push-test-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("accepted", { status: 202 })),
    );
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

  it("requires authentication", async () => {
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/message-push-policies/1/test", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("sends a test message and records delivery history", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite);
    const policyId = insertPolicy(sqlite);
    const route = await import("./route");

    const response = await route.POST(
      new Request(`http://localhost/api/message-push-policies/${policyId}/test`, {
        method: "POST",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: String(policyId) }) },
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .prepare(`
          SELECT delivery_type, trigger_key, status, message
          FROM message_push_deliveries
          ORDER BY id
        `)
        .all(),
    ).toEqual([
      {
        delivery_type: "webhook",
        trigger_key: "test",
        status: "success",
        message: "这是一条测试消息",
      },
      {
        delivery_type: "browser_notification",
        trigger_key: "test",
        status: "success",
        message: "测试：测试CPA / 这是一条测试消息",
      },
    ]);
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database) {
  sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, enabled)
      VALUES ('target', 'https://target.example.com', 'secret', 1)
    `)
    .run();
}

function insertPolicy(sqlite: Database.Database) {
  return Number(
    sqlite
      .prepare(`
        INSERT INTO message_push_policies (
          name,
          delivery_type,
          trigger_type,
          threshold_percent,
          scope_type,
          webhook_url,
          headers_json,
          body_template,
          enabled
        )
        VALUES (
          'test policy',
          'webhook,browser_notification',
          'account_exception',
          NULL,
          'all_enabled',
          'https://webhook.example.com/push',
          '{}',
          '测试：{{cpaName}} / {{msg}}',
          1
        )
      `)
      .run().lastInsertRowid,
  );
}

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
