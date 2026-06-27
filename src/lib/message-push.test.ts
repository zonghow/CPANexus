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
    insertAuthFile(sqlite, cpaInstanceId, "account-0@example.com", true);
    insertAuthFile(sqlite, cpaInstanceId, "account-1@example.com", true);
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

  it("uses the auth-management remaining algorithm for threshold notifications", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Weighted CPA");
    insertAuthFile(sqlite, cpaInstanceId, "plus@example.com", true);
    insertAuthFile(sqlite, cpaInstanceId, "pro@example.com", true);
    insertAuthFile(sqlite, cpaInstanceId, "free@example.com", true);
    insertAuthFile(sqlite, cpaInstanceId, "dead@example.com", false, "refresh failed");
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "plus@example.com.json",
      email: "plus@example.com",
      usage5hPercent: 90,
      rawJson: JSON.stringify({ plan_type: "plus" }),
    });
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "pro@example.com.json",
      email: "pro@example.com",
      usage5hPercent: 50,
      rawJson: JSON.stringify({ plan_type: "pro" }),
    });
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "free@example.com.json",
      email: "free@example.com",
      usage5hPercent: 0,
      rawJson: JSON.stringify({ plan_type: "free" }),
    });
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "dead@example.com.json",
      email: "dead@example.com",
      available: false,
      exception: "refresh failed",
      usage5hPercent: 0,
      rawJson: JSON.stringify({ plan_type: "plus" }),
    });
    insertPolicy(sqlite, {
      name: "weighted 5h low",
      triggerType: "remaining_5h_below",
      thresholdPercent: 50,
      bodyTemplate: "{{cpaName}} {{value}} {{threshold}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: "Weighted CPA 48 50",
    });
    expect(activeState(sqlite)).toEqual({
      active: 1,
      last_value: 48,
    });
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

  it("aggregates exception accounts by subscription type", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Typed CPA");
    insertAuthFile(sqlite, cpaInstanceId, "plus-1@example.com", false, "refresh failed");
    insertAuthFile(sqlite, cpaInstanceId, "plus-2@example.com", false, "refresh failed");
    insertAuthFile(sqlite, cpaInstanceId, "pro-1@example.com", false, "refresh failed");
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "plus-1@example.com.json",
      email: "plus-1@example.com",
      available: false,
      exception: "refresh failed",
      rawJson: JSON.stringify({ plan_type: "plus" }),
    });
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "plus-2@example.com.json",
      email: "plus-2@example.com",
      available: false,
      exception: "refresh failed",
      rawJson: JSON.stringify({ plan_type: "Plus" }),
    });
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "pro-1@example.com.json",
      email: "pro-1@example.com",
      available: false,
      exception: "refresh failed",
      rawJson: JSON.stringify({ plan_type: "pro" }),
    });
    insertPolicy(sqlite, {
      name: "typed exceptions",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "死号：{{exceptionByType}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: "死号：plus 2个、pro 1个",
    });
  });

  it("falls back to the auth file plan type when the quota snapshot lacks one", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Fallback CPA");
    insertAuthFile(
      sqlite,
      cpaInstanceId,
      "dead-plus@example.com",
      false,
      "refresh failed",
      JSON.stringify({ plan_type: "plus" }),
    );
    // Dead account's quota probe failed, so its snapshot carries no plan_type.
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "dead-plus@example.com.json",
      email: "dead-plus@example.com",
      available: false,
      exception: "refresh failed",
      rawJson: null,
    });
    insertPolicy(sqlite, {
      name: "fallback exceptions",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "死号：{{exceptionByType}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: "死号：plus 1个",
    });
  });

  it("does not treat rate-limited accounts as account exceptions", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite, "Limited CPA");
    insertAuthFile(sqlite, cpaInstanceId, "limited@example.com", false);
    insertQuotaSnapshot(sqlite, {
      cpaInstanceId,
      authFileName: "limited@example.com.json",
      email: "limited@example.com",
      available: false,
      exception: null,
      rawJson: JSON.stringify({
        rate_limit: { limit_reached: true },
        rate_limit_reached_type: { type: "rate_limit_reached" },
      }),
    });
    insertPolicy(sqlite, {
      name: "exceptions",
      triggerType: "account_exception",
      thresholdPercent: null,
      bodyTemplate: "{{msg}}",
    });

    const { evaluateMessagePushPoliciesForCpa } = await import("./message-push");

    await evaluateMessagePushPoliciesForCpa(cpaInstanceId);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM message_push_deliveries").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM message_push_states").get(),
    ).toEqual({ count: 0 });
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
      message: "浏览器通知：Browser CPA 有 1 个账号异常（未知 1个）：dead-browser@example.com",
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
        message: "Combined CPA 有 1 个账号异常（未知 1个）：dead-combined@example.com",
      },
      {
        delivery_type: "browser_notification",
        status: "success",
        message: "Combined CPA 有 1 个账号异常（未知 1个）：dead-combined@example.com",
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
  rawJson: string | null = null,
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
        available,
        raw_json
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `)
    .run(
      cpaInstanceId,
      `${email}.json`,
      email,
      available ? "可用" : "异常",
      statusMessage,
      available ? 1 : 0,
      rawJson,
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

function insertQuotaSnapshot(
  sqlite: Database.Database,
  values: {
    cpaInstanceId: number;
    authFileName: string;
    email: string;
    usage5hPercent?: number;
    usageWeekPercent?: number;
    available?: boolean;
    exception?: string | null;
    rawJson?: string | null;
  },
) {
  sqlite
    .prepare(`
      INSERT INTO quota_snapshots (
        cpa_instance_id,
        auth_file_name,
        email,
        usage_5h_percent,
        usage_week_percent,
        available,
        exception,
        raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      values.cpaInstanceId,
      values.authFileName,
      values.email,
      values.usage5hPercent ?? 100,
      values.usageWeekPercent ?? 31,
      (values.available ?? true) ? 1 : 0,
      values.exception ?? null,
      values.rawJson ?? null,
    );
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
