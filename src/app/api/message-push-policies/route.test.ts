import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/message-push-policies", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-message-push-route-"));
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

    const response = await route.GET(new Request("http://localhost/api/message-push-policies"));

    expect(response.status).toBe(401);
  });

  it("creates and lists policies with custom CPA scope links", async () => {
    const sqlite = await setupSqlite();
    const cpaAId = insertInstance(sqlite, "CPA A");
    const cpaBId = insertInstance(sqlite, "CPA B");
    const route = await import("./route");

    const createResponse = await route.POST(
      jsonRequest("http://localhost/api/message-push-policies", {
        name: "异常通知",
        triggerType: "account_exception",
        thresholdPercent: null,
        scopeType: "custom",
        cpaInstanceIds: [cpaAId, cpaBId],
        webhookUrl: "https://webhook.example.com/push",
        headersJson: '{"content-type":"text/plain"}',
        bodyTemplate: "有账号死啦：{{msg}}",
        enabled: true,
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      policy: { id: number; cpaInstanceIds: number[]; triggerType: string };
    };
    expect(created.policy).toMatchObject({
      deliveryType: "webhook",
      deliveryTypes: ["webhook"],
      triggerType: "account_exception",
      cpaInstanceIds: [cpaAId, cpaBId],
    });

    const listResponse = await route.GET(
      new Request("http://localhost/api/message-push-policies", {
        headers: authHeaders(),
      }),
    );
    const listed = (await listResponse.json()) as {
      policies: Array<{ name: string; cpaInstanceIds: number[] }>;
      instances: Array<{ id: number; name: string }>;
    };

    expect(listed.policies).toMatchObject([
      {
        name: "异常通知",
        cpaInstanceIds: [cpaAId, cpaBId],
      },
    ]);
    expect(listed.instances.map((instance) => instance.name)).toEqual(["CPA A", "CPA B"]);
  });

  it("updates and deletes policies", async () => {
    const sqlite = await setupSqlite();
    const cpaAId = insertInstance(sqlite, "CPA A");
    const cpaBId = insertInstance(sqlite, "CPA B");
    const collectionRoute = await import("./route");
    const itemRoute = await import("./[id]/route");
    const createResponse = await collectionRoute.POST(
      jsonRequest("http://localhost/api/message-push-policies", {
        name: "5h通知",
        triggerType: "remaining_5h_below",
        thresholdPercent: 20,
        scopeType: "custom",
        cpaInstanceIds: [cpaAId],
        webhookUrl: "https://webhook.example.com/push",
        headersJson: "{}",
        bodyTemplate: "{{msg}}",
        enabled: true,
      }),
    );
    const created = (await createResponse.json()) as { policy: { id: number } };

    const updateResponse = await itemRoute.PUT(
      jsonRequest(`http://localhost/api/message-push-policies/${created.policy.id}`, {
        name: "周通知",
        triggerType: "remaining_week_below",
        thresholdPercent: 35,
        scopeType: "custom",
        cpaInstanceIds: [cpaBId],
        webhookUrl: "https://webhook.example.com/weekly",
        headersJson: '{"x-token":"abc"}',
        bodyTemplate: "周剩余 {{value}}",
        enabled: false,
      }),
      { params: Promise.resolve({ id: String(created.policy.id) }) },
    );

    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as {
      policy: {
        name: string;
        triggerType: string;
        thresholdPercent: number;
        enabled: boolean;
        cpaInstanceIds: number[];
      };
    };
    expect(updated.policy).toMatchObject({
      name: "周通知",
      triggerType: "remaining_week_below",
      thresholdPercent: 35,
      enabled: false,
      cpaInstanceIds: [cpaBId],
    });

    const deleteResponse = await itemRoute.DELETE(
      new Request(`http://localhost/api/message-push-policies/${created.policy.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: String(created.policy.id) }) },
    );

    expect(deleteResponse.status).toBe(200);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM message_push_policies").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM message_push_policy_cpa_instances").get(),
    ).toEqual({ count: 0 });
  });

  it("creates browser notification policies without webhook settings", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite, "CPA A");
    const route = await import("./route");

    const createResponse = await route.POST(
      jsonRequest("http://localhost/api/message-push-policies", {
        name: "浏览器异常通知",
        deliveryType: "browser_notification",
        triggerType: "account_exception",
        thresholdPercent: null,
        scopeType: "all_enabled",
        cpaInstanceIds: [],
        webhookUrl: "",
        headersJson: "",
        bodyTemplate: "{{msg}}",
        enabled: true,
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      policy: {
        deliveryType: string;
        webhookUrl: string;
        headersJson: string;
      };
    };
    expect(created.policy).toMatchObject({
      deliveryType: "browser_notification",
      deliveryTypes: ["browser_notification"],
      webhookUrl: "",
      headersJson: "{}",
    });
  });

  it("creates policies with both webhook and browser notification delivery", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite, "CPA A");
    const route = await import("./route");

    const createResponse = await route.POST(
      jsonRequest("http://localhost/api/message-push-policies", {
        name: "双通道通知",
        deliveryTypes: ["webhook", "browser_notification"],
        triggerType: "account_exception",
        thresholdPercent: null,
        scopeType: "all_enabled",
        cpaInstanceIds: [],
        webhookUrl: "https://webhook.example.com/push",
        headersJson: '{"content-type":"application/json"}',
        bodyTemplate: "{{msg}}",
        enabled: true,
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      policy: {
        deliveryType: string;
        deliveryTypes: string[];
      };
    };
    expect(created.policy).toMatchObject({
      deliveryType: "webhook,browser_notification",
      deliveryTypes: ["webhook", "browser_notification"],
    });
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
      .run(name, `https://${name.toLowerCase().replaceAll(" ", "-")}.example.com`).lastInsertRowid,
  );
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
