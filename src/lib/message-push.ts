import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  cpaInstances,
  messagePushDeliveries,
  messagePushPolicies,
  messagePushPolicyCpaInstances,
  messagePushStates,
  quotaSnapshots,
  type AuthFile,
  type MessagePushPolicy,
} from "@/db/schema";

import { averageAccountRemainingPercent } from "./quota-summary";
import { resolveAccountQuotaStatus } from "./account-quota-status";
import { extractSubscriptionType } from "./subscription";

export const messagePushTriggerTypes = [
  "account_exception",
  "remaining_5h_below",
  "remaining_week_below",
] as const;

export const messagePushScopeTypes = ["all_enabled", "custom"] as const;
export const messagePushDeliveryTypes = ["webhook", "browser_notification"] as const;

export type MessagePushTriggerType = (typeof messagePushTriggerTypes)[number];
export type MessagePushScopeType = (typeof messagePushScopeTypes)[number];
export type MessagePushDeliveryType = (typeof messagePushDeliveryTypes)[number];

type TemplateVars = Record<string, string | number | null | undefined>;

type CpaSnapshot = {
  cpaName: string;
  accountCount: number;
  exceptionCount: number;
  exceptionSummary: string;
  exceptionByType: string;
  remaining5hPercent: number | null;
  remainingWeekPercent: number | null;
};

type QuotaSnapshotForStatus = typeof quotaSnapshots.$inferSelect;

type TriggerEvaluation = {
  active: boolean;
  triggerKey: MessagePushTriggerType | "test";
  triggerLabel: string;
  value: number | null;
  threshold: number | null;
  message: string;
};

const testMessagePushVars = {
  msg: "这是一条测试消息",
  trigger: "测试推送",
  cpaName: "测试CPA",
  value: 10,
  threshold: 20,
  accountCount: 52,
  exceptionByType: "plus 2个、pro 1个",
} as const;

export async function evaluateMessagePushPoliciesForCpa(cpaInstanceId: number) {
  const instance = db
    .select()
    .from(cpaInstances)
    .where(and(eq(cpaInstances.id, cpaInstanceId), eq(cpaInstances.enabled, true)))
    .get();

  if (!instance) {
    return;
  }

  const policies = db
    .select()
    .from(messagePushPolicies)
    .where(eq(messagePushPolicies.enabled, true))
    .all();
  if (policies.length === 0) {
    return;
  }

  const links = db
    .select()
    .from(messagePushPolicyCpaInstances)
    .where(eq(messagePushPolicyCpaInstances.cpaInstanceId, cpaInstanceId))
    .all();
  const linkedPolicyIds = new Set(links.map((link) => link.policyId));
  const matchingPolicies = policies.filter((policy) =>
    policy.scopeType === "all_enabled" || linkedPolicyIds.has(policy.id),
  );
  if (matchingPolicies.length === 0) {
    return;
  }

  const snapshot = buildCpaSnapshot(cpaInstanceId, instance.name);
  for (const policy of matchingPolicies) {
    await evaluatePolicyForSnapshot(policy, cpaInstanceId, snapshot);
  }
}

export function renderMessagePushTemplate(template: string, vars: TemplateVars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export async function sendTestMessagePushPolicy(policyId: number) {
  const policy = db
    .select()
    .from(messagePushPolicies)
    .where(eq(messagePushPolicies.id, policyId))
    .get();
  if (!policy) {
    throw new Error("message push policy not found");
  }

  const instance = db
    .select()
    .from(cpaInstances)
    .where(eq(cpaInstances.enabled, true))
    .get() ?? db.select().from(cpaInstances).get();
  if (!instance) {
    throw new Error("CPA instance is required to record test delivery");
  }

  const body = renderMessagePushTemplate(policy.bodyTemplate, testMessagePushVars);
  await deliverAndRecord(
    policy,
    instance.id,
    {
      active: true,
      triggerKey: "test",
      triggerLabel: testMessagePushVars.trigger,
      value: testMessagePushVars.value,
      threshold: testMessagePushVars.threshold,
      message: testMessagePushVars.msg,
    },
    body,
    nowIso(),
  );
}

async function evaluatePolicyForSnapshot(
  policy: MessagePushPolicy,
  cpaInstanceId: number,
  snapshot: CpaSnapshot,
) {
  const evaluation = evaluateTrigger(policy, snapshot);
  const state = db
    .select()
    .from(messagePushStates)
    .where(
      and(
        eq(messagePushStates.policyId, policy.id),
        eq(messagePushStates.cpaInstanceId, cpaInstanceId),
        eq(messagePushStates.triggerKey, evaluation.triggerKey),
      ),
    )
    .get();

  if (evaluation.active) {
    if (state?.active) {
      return;
    }

    const now = nowIso();
    const body = renderMessagePushTemplate(policy.bodyTemplate, {
      msg: evaluation.message,
      trigger: evaluation.triggerLabel,
      cpaName: snapshot.cpaName,
      value: evaluation.value,
      threshold: evaluation.threshold,
      accountCount: snapshot.accountCount,
      exceptionByType: snapshot.exceptionByType,
    });
    await deliverAndRecord(policy, cpaInstanceId, evaluation, body, now);
    upsertActiveState(policy.id, cpaInstanceId, evaluation, now);
    return;
  }

  if (state?.active) {
    db.update(messagePushStates)
      .set({
        active: false,
        recoveredAt: nowIso(),
      })
      .where(eq(messagePushStates.id, state.id))
      .run();
  }
}

function buildCpaSnapshot(cpaInstanceId: number, cpaName: string): CpaSnapshot {
  const files = db
    .select()
    .from(authFiles)
    .where(eq(authFiles.cpaInstanceId, cpaInstanceId))
    .all();
  const quotas = db
    .select()
    .from(quotaSnapshots)
    .where(eq(quotaSnapshots.cpaInstanceId, cpaInstanceId))
    .orderBy(desc(quotaSnapshots.capturedAt))
    .limit(300)
    .all();
  const latestQuotas = latestQuotaSnapshotsByAccount(quotas);
  const activeAuthFiles = files.filter((file) => !file.disabled);
  const exceptionFiles = activeAuthFiles.filter((file) =>
    isExceptionAuthFile(file, latestQuotas),
  );
  const accountRows = activeAuthFiles.map((file) =>
    accountRemainingPercentRow(file, latestQuotas),
  );

  return {
    cpaName,
    accountCount: activeAuthFiles.length,
    exceptionCount: exceptionFiles.length,
    exceptionSummary: exceptionFiles
      .slice(0, 5)
      .map((file) => file.email ?? file.fileName)
      .join("、"),
    exceptionByType: summarizeExceptionByType(exceptionFiles, latestQuotas),
    remaining5hPercent: averageAccountRemainingPercent(
      accountRows,
      "usage5hPercent",
    ),
    remainingWeekPercent: averageAccountRemainingPercent(
      accountRows,
      "usageWeekPercent",
    ),
  };
}

function evaluateTrigger(
  policy: MessagePushPolicy,
  snapshot: CpaSnapshot,
): TriggerEvaluation {
  if (policy.triggerType === "account_exception") {
    const message = snapshot.exceptionCount > 0
      ? `${snapshot.cpaName} 有 ${snapshot.exceptionCount} 个账号异常（${snapshot.exceptionByType}）：${snapshot.exceptionSummary}`
      : `${snapshot.cpaName} 暂无账号异常`;
    return {
      active: snapshot.exceptionCount > 0,
      triggerKey: "account_exception",
      triggerLabel: "有账号出现异常",
      value: snapshot.exceptionCount,
      threshold: null,
      message,
    };
  }

  if (policy.triggerType === "remaining_week_below") {
    return evaluateRemainingThreshold(
      "remaining_week_below",
      "周剩余低于",
      snapshot.cpaName,
      snapshot.remainingWeekPercent,
      policy.thresholdPercent,
    );
  }

  return evaluateRemainingThreshold(
    "remaining_5h_below",
    "5h剩余低于",
    snapshot.cpaName,
    snapshot.remaining5hPercent,
    policy.thresholdPercent,
  );
}

function evaluateRemainingThreshold(
  triggerKey: "remaining_5h_below" | "remaining_week_below",
  triggerLabel: string,
  cpaName: string,
  value: number | null,
  threshold: number | null,
): TriggerEvaluation {
  const active = value !== null && threshold !== null && value < threshold;
  return {
    active,
    triggerKey,
    triggerLabel,
    value,
    threshold,
    message: value === null || threshold === null
      ? `${cpaName} 暂无${triggerLabel.replace("低于", "")}数据`
      : `${cpaName} ${triggerLabel.replace("低于", "")} ${value}%，低于阈值 ${threshold}%`,
  };
}

async function deliverAndRecord(
  policy: MessagePushPolicy,
  cpaInstanceId: number,
  evaluation: TriggerEvaluation,
  body: string,
  sentAt: string,
) {
  for (const deliveryType of deliveryTypesForPolicy(policy)) {
    await deliverOneAndRecord(policy, cpaInstanceId, evaluation, body, sentAt, deliveryType);
  }
}

async function deliverOneAndRecord(
  policy: MessagePushPolicy,
  cpaInstanceId: number,
  evaluation: TriggerEvaluation,
  body: string,
  sentAt: string,
  deliveryType: MessagePushDeliveryType,
) {
  if (deliveryType === "browser_notification") {
    db.insert(messagePushDeliveries)
      .values({
        policyId: policy.id,
        cpaInstanceId,
        deliveryType: "browser_notification",
        triggerKey: evaluation.triggerKey,
        status: "success",
        message: body,
        responseStatus: null,
        responseBody: "queued for open browser sessions",
        error: null,
        sentAt,
      })
      .run();
    return;
  }

  try {
    const response = await fetch(policy.webhookUrl, {
      method: "POST",
      headers: parseHeadersJson(policy.headersJson),
      body,
    });
    const responseBody = await safeResponseText(response);
    db.insert(messagePushDeliveries)
      .values({
        policyId: policy.id,
        cpaInstanceId,
        deliveryType: "webhook",
        triggerKey: evaluation.triggerKey,
        status: response.ok ? "success" : "error",
        message: evaluation.message,
        responseStatus: response.status,
        responseBody,
        error: response.ok ? null : response.statusText,
        sentAt,
      })
      .run();
  } catch (error) {
    db.insert(messagePushDeliveries)
      .values({
        policyId: policy.id,
        cpaInstanceId,
        deliveryType: "webhook",
        triggerKey: evaluation.triggerKey,
        status: "error",
        message: evaluation.message,
        responseStatus: null,
        responseBody: null,
        error: errorMessage(error),
        sentAt,
      })
      .run();
  }
}

function deliveryTypesForPolicy(
  policy: Pick<MessagePushPolicy, "deliveryType">,
): MessagePushDeliveryType[] {
  const values = policy.deliveryType
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is MessagePushDeliveryType =>
      (messagePushDeliveryTypes as readonly string[]).includes(value),
    );
  return values.length > 0 ? values : ["webhook"];
}

function upsertActiveState(
  policyId: number,
  cpaInstanceId: number,
  evaluation: TriggerEvaluation,
  now: string,
) {
  db.insert(messagePushStates)
    .values({
      policyId,
      cpaInstanceId,
      triggerKey: evaluation.triggerKey,
      active: true,
      activatedAt: now,
      recoveredAt: null,
      lastSentAt: now,
      lastValue: evaluation.value,
      lastMessage: evaluation.message,
    })
    .onConflictDoUpdate({
      target: [
        messagePushStates.policyId,
        messagePushStates.cpaInstanceId,
        messagePushStates.triggerKey,
      ],
      set: {
        active: true,
        activatedAt: now,
        recoveredAt: null,
        lastSentAt: now,
        lastValue: evaluation.value,
        lastMessage: evaluation.message,
      },
    })
    .run();
}

function isExceptionAuthFile(file: AuthFile, quotas: QuotaSnapshotForStatus[]) {
  const quota = matchingQuotaSnapshot(file, quotas);
  const status = resolveAuthFileQuotaStatus(file, quota);

  return status.state === "exception";
}

function summarizeExceptionByType(
  exceptionFiles: AuthFile[],
  quotas: QuotaSnapshotForStatus[],
) {
  const counts = new Map<string, number>();
  for (const file of exceptionFiles) {
    const quota = matchingQuotaSnapshot(file, quotas);
    const type = extractSubscriptionType(quota?.rawJson ?? null);
    const label = type && type.trim() ? type.trim().toLowerCase() : "未知";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} ${count}个`)
    .join("、");
}

function accountRemainingPercentRow(
  file: AuthFile,
  quotas: QuotaSnapshotForStatus[],
) {
  const quota = matchingQuotaSnapshot(file, quotas);
  const quotaStatus = resolveAuthFileQuotaStatus(file, quota);

  return {
    subscriptionType: extractSubscriptionType(quota?.rawJson ?? null),
    quotaStatus: quotaStatus.state,
    usage5hPercent: quota?.usage5hPercent ?? null,
    usageWeekPercent: quota?.usageWeekPercent ?? null,
  };
}

function resolveAuthFileQuotaStatus(
  file: AuthFile,
  quota: QuotaSnapshotForStatus | null,
) {
  const disabled = Boolean(file.disabled);
  const available = disabled ? false : (quota?.available ?? file.available);
  const exception = disabled
    ? null
    : quota
      ? quota.exception
      : (file.statusMessage ?? (available ? null : (file.status ?? "异常")));

  return resolveAccountQuotaStatus({
    disabled,
    available,
    exception,
    rawJson: disabled ? null : (quota?.rawJson ?? null),
  });
}

function matchingQuotaSnapshot(file: AuthFile, quotas: QuotaSnapshotForStatus[]) {
  const email = file.email?.toLowerCase() ?? null;
  return quotas.find((snapshot) => {
    if (snapshot.authFileName && snapshot.authFileName === file.fileName) {
      return true;
    }
    if (email && snapshot.email?.toLowerCase() === email) {
      return true;
    }
    return false;
  }) ?? null;
}

function latestQuotaSnapshotsByAccount<
  T extends { email: string | null; authFileName: string | null },
>(
  rows: T[],
) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    const key = row.email || row.authFileName;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }

  return result;
}

function parseHeadersJson(value: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, headerValue]) => [
        key,
        String(headerValue),
      ]),
    );
  } catch {
    return {};
  }
}

async function safeResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function nowIso() {
  return new Date().toISOString();
}
