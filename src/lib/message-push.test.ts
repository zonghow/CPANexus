import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("message push evaluation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-message-push-"));
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

  it("sends a remaining-threshold notification once until the CPA recovers", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "target");
    insertAuthFile(sqlite, cpaInstanceId, "a@example.com", true);
    insertAuthFile(sqlite, cpaInstanceId, "b@example.com", true);
    replaceQuotaSnapshots(sqlite, cpaInstanceId, [80, 90]);
    insertPolicy(sqlite, {
      name: "5h low",
      triggerType: "remaining_5h_below",
      thresholdPercent: 20,
      bodyTemplate: "{{cpaName}} {{value}} {{threshold}} {{msg}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);
    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://webhook.example.com/push");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "x-test": "yes" },
      body: expect.stringContaining("target 15 20"),
    });

    expect(activeState(sqlite)).toEqual({
      active: 1,
      last_value: 15,
    });

    replaceQuotaSnapshots(sqlite, cpaInstanceId, [50, 50]);
    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(activeState(sqlite)).toEqual({
      active: 0,
      last_value: 15,
    });

    replaceQuotaSnapshots(sqlite, cpaInstanceId, [90, 90]);
    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends account-exception notifications only for CPAs in a custom scope", async () => {
    const sqlite = await setupSqlite();
    const cpaAId = insertInstance(sqlite, "CPA A");
    const cpaBId = insertInstance(sqlite, "CPA B");
    insertAuthFile(sqlite, cpaAId, "dead-a@example.com", false, "refresh failed");
    insertAuthFile(sqlite, cpaBId, "dead-b@example.com", false, "also failed");
    const policyId = insertPolicy(sqlite, {
      name: "exceptions",
      triggerType: "account_exception",
      thresholdPercent: null,
      scopeType: "custom",
      bodyTemplate: "有账号死啦：{{msg}} / {{cpaName}} / {{accountCount}}",
    });
    sqlite
      .prepare(`
        INSERT INTO message_push_policy_cpa_instances (policy_id, cpa_instance_id)
        VALUES (?, ?)
      `)
      .run(policyId, cpaAId);

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaAId);
    await evaluateMessagePushPoliciesForCpa(cpaBId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("CPA A / 1"),
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("dead-a@example.com"),
    });
  });

  it("records browser notifications without calling an external webhook", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Browser CPA");
    insertAuthFile(sqlite, cpaInstanceId, "dead-browser@example.com", false, "refresh failed");
    insertPolicy(sqlite, {
      name: "browser exceptions",
      deliveryType: "browser_notification",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "浏览器通知：{{msg}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(
      sqlite
        .prepare(`
          SELECT delivery_type, status, message, response_status, response_body
          FROM message_push_deliveries
        `)
        .get(),
    ).toEqual({
      delivery_type: "browser_notification",
      status: "success",
      message: "浏览器通知：Browser CPA 有 1 个账号异常：dead-browser@example.com",
      response_status: null,
      response_body: "queued for open browser sessions",
    });
  });

  it("delivers both webhook and browser notifications for combined policies", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Combined CPA");
    insertAuthFile(sqlite, cpaInstanceId, "dead-combined@example.com", false, "refresh failed");
    insertPolicy(sqlite, {
      name: "combined exceptions",
      deliveryType: "webhook,browser_notification",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "{{msg}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .prepare(`
          SELECT delivery_type, status, message
          FROM message_push_deliveries
          ORDER BY id
        `)
        .all(),
    ).toEqual([
      {
        delivery_type: "webhook",
        status: "success",
        message: "Combined CPA 有 1 个账号异常：dead-combined@example.com",
      },
      {
        delivery_type: "browser_notification",
        status: "success",
        message: "Combined CPA 有 1 个账号异常：dead-combined@example.com",
      },
    ]);
  });

  it("sends test messages through every delivery type without touching dedupe state", async () => {
    const sqlite = await setupSqlite();
    insertInstance(sqlite, "Real CPA");
    const policyId = insertPolicy(sqlite, {
      name: "testable policy",
      deliveryType: "webhook,browser_notification",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "{{trigger}} {{cpaName}} {{value}}/{{threshold}} {{accountCount}} {{msg}}",
    });

    const { sendTestMessagePushPolicy } = await import("./message-push");

    await sendTestMessagePushPolicy(policyId);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      body: "测试推送 测试CPA 10/20 52 这是一条测试消息",
    });
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
        message: "测试推送 测试CPA 10/20 52 这是一条测试消息",
      },
    ]);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM message_push_states").get(),
    ).toEqual({ count: 0 });
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

function insertAuthFile(
  sqlite: Database.Database,
  cpaInstanceId: number,
  email: string,
  available: boolean,
  statusMessage: string | null = null,
) {
  sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        status,
        status_message,
        disabled,
        available
      )
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `)
    .run(
      cpaInstanceId,
      `${email}.json`,
      email,
      available ? "可用" : "异常",
      statusMessage,
      available ? 1 : 0,
    );
}

function replaceQuotaSnapshots(
  sqlite: Database.Database,
  cpaInstanceId: number,
  usage5hValues: number[],
) {
  sqlite
    .prepare("DELETE FROM quota_snapshots WHERE cpa_instance_id = ?")
    .run(cpaInstanceId);
  for (const [index, usage5hPercent] of usage5hValues.entries()) {
    sqlite
      .prepare(`
        INSERT INTO quota_snapshots (
          cpa_instance_id,
          auth_file_name,
          email,
          usage_5h_percent,
          usage_week_percent,
          available
        )
        VALUES (?, ?, ?, ?, 20, 1)
      `)
      .run(
        cpaInstanceId,
        `account-${index}.json`,
        `account-${index}@example.com`,
        usage5hPercent,
      );
  }
}

function insertPolicy(
  sqlite: Database.Database,
  values: {
    name: string;
    deliveryType?: string;
    triggerType: string;
    thresholdPercent: number | null;
    scopeType?: string;
    bodyTemplate: string;
  },
) {
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
        VALUES (?, ?, ?, ?, ?, 'https://webhook.example.com/push', '{"x-test":"yes"}', ?, 1)
      `)
      .run(
        values.name,
        values.deliveryType ?? "webhook",
        values.triggerType,
        values.thresholdPercent,
        values.scopeType ?? "all_enabled",
        values.bodyTemplate,
      ).lastInsertRowid,
  );
}

function activeState(sqlite: Database.Database) {
  return sqlite
    .prepare("SELECT active, last_value FROM message_push_states")
    .get();
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: {
      close: () => void;
    };
  };
}
