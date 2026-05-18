import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/message-push-deliveries", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-message-push-deliveries-"));
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

  it("requires authentication", async () => {
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost/api/message-push-deliveries"));

    expect(response.status).toBe(401);
  });

  it("returns paginated delivery history with policy and CPA names", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "whistlelads");
    const policyId = insertPolicy(sqlite, "5h用量低");
    insertDelivery(sqlite, {
      policyId,
      cpaInstanceId,
      status: "success",
      message: "first",
      sentAt: "2026-05-18T08:18:38.000Z",
    });
    for (let index = 0; index < 9; index += 1) {
      insertDelivery(sqlite, {
        policyId,
        cpaInstanceId,
        status: "success",
        message: `older-${index}`,
        sentAt: new Date(Date.UTC(2026, 4, 18, 7, index, 0)).toISOString(),
      });
    }
    insertDelivery(sqlite, {
      policyId,
      cpaInstanceId,
      status: "error",
      message: "second",
      responseStatus: 400,
      error: "bad request",
      sentAt: "2026-05-18T08:20:38.000Z",
    });
    const route = await import("./route");

    const response = await route.GET(
      new Request("http://localhost/api/message-push-deliveries?page=1&pageSize=10", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      deliveries: Array<{
        policyName: string | null;
        cpaInstanceName: string | null;
        deliveryType: string;
        status: string;
        message: string;
        responseStatus: number | null;
        error: string | null;
      }>;
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    };

    expect(payload.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 11,
      totalPages: 2,
    });
    expect(payload.deliveries).toHaveLength(10);
    expect(payload.deliveries[0]).toEqual(
      expect.objectContaining({
        policyName: "5h用量低",
        cpaInstanceName: "whistlelads",
        deliveryType: "webhook",
        status: "error",
        message: "second",
        responseStatus: 400,
        error: "bad request",
      }),
    );
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database, name: string) {
  return Number(
    sqlite
      .prepare(`
        INSERT INTO cpa_instances (name, base_url, password, enabled)
        VALUES (?, ?, 'secret', 1)
      `)
      .run(name, `https://${name}.example.com`).lastInsertRowid,
  );
}

function insertPolicy(sqlite: Database.Database, name: string) {
  return Number(
    sqlite
      .prepare(`
        INSERT INTO message_push_policies (
          name,
          trigger_type,
          threshold_percent,
          scope_type,
          webhook_url,
          headers_json,
          body_template,
          enabled
        )
        VALUES (?, 'remaining_5h_below', 50, 'all_enabled', 'https://webhook.example.com', '{}', '{{msg}}', 1)
      `)
      .run(name).lastInsertRowid,
  );
}

function insertDelivery(
  sqlite: Database.Database,
  values: {
    policyId: number;
    cpaInstanceId: number;
    status: string;
    message: string;
    responseStatus?: number | null;
    error?: string | null;
    sentAt: string;
  },
) {
  sqlite
    .prepare(`
      INSERT INTO message_push_deliveries (
        policy_id,
        cpa_instance_id,
        trigger_key,
        status,
        message,
        response_status,
        response_body,
        error,
        sent_at
      )
      VALUES (?, ?, 'remaining_5h_below', ?, ?, ?, '{}', ?, ?)
    `)
    .run(
      values.policyId,
      values.cpaInstanceId,
      values.status,
      values.message,
      values.responseStatus ?? null,
      values.error ?? null,
      values.sentAt,
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
