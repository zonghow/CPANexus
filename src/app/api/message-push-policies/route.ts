import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  cpaInstances,
  messagePushPolicies,
  messagePushPolicyCpaInstances,
  type MessagePushPolicy,
} from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";
import {
  messagePushDeliveryTypes,
  messagePushScopeTypes,
  messagePushTriggerTypes,
  type MessagePushDeliveryType,
  type MessagePushScopeType,
  type MessagePushTriggerType,
} from "@/lib/message-push";

export const runtime = "nodejs";

export const messagePushPolicySchema = z.object({
  name: z.string().trim().min(1),
  deliveryType: z.enum(messagePushDeliveryTypes).default("webhook"),
  deliveryTypes: z.array(z.enum(messagePushDeliveryTypes)).optional(),
  triggerType: z.enum(messagePushTriggerTypes),
  thresholdPercent: z.number().min(0).max(100).nullable().optional(),
  scopeType: z.enum(messagePushScopeTypes).default("all_enabled"),
  cpaInstanceIds: z.array(z.number().int().positive()).default([]),
  webhookUrl: z.string().trim().default(""),
  headersJson: z.string().trim().default("{}"),
  bodyTemplate: z.string().trim().min(1),
  enabled: z.boolean().default(true),
}).superRefine((value, context) => {
  const deliveryTypes = normalizedDeliveryTypes(value);
  if (deliveryTypes.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["deliveryTypes"],
      message: "at least one delivery type is required",
    });
  }

  if (deliveryTypes.includes("webhook")) {
    if (!z.string().url().safeParse(value.webhookUrl).success) {
      context.addIssue({
        code: "custom",
        path: ["webhookUrl"],
        message: "webhookUrl must be a valid URL",
      });
    }
    if (!isJsonObjectString(value.headersJson)) {
      context.addIssue({
        code: "custom",
        path: ["headersJson"],
        message: "headersJson must be a JSON object",
      });
    }
  }

  if (value.triggerType === "account_exception" && value.thresholdPercent !== null && value.thresholdPercent !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["thresholdPercent"],
      message: "thresholdPercent must be null for account exception policies",
    });
  }

  if (value.triggerType !== "account_exception" && typeof value.thresholdPercent !== "number") {
    context.addIssue({
      code: "custom",
      path: ["thresholdPercent"],
      message: "thresholdPercent is required for remaining-threshold policies",
    });
  }

  if (value.scopeType === "custom" && value.cpaInstanceIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["cpaInstanceIds"],
      message: "custom scope requires at least one CPA instance",
    });
  }
});

export type MessagePushPolicyInput = z.infer<typeof messagePushPolicySchema>;

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    return ok(messagePushPolicyListPayload());
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const parsed = messagePushPolicySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const now = new Date().toISOString();
    const policy = db
      .insert(messagePushPolicies)
      .values({
        name: parsed.data.name,
        deliveryType: normalizedDeliveryType(parsed.data),
        triggerType: parsed.data.triggerType,
        thresholdPercent: normalizedThreshold(parsed.data),
        scopeType: parsed.data.scopeType,
        webhookUrl: normalizedWebhookUrl(parsed.data),
        headersJson: normalizedHeadersJson(parsed.data),
        bodyTemplate: parsed.data.bodyTemplate,
        enabled: parsed.data.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    replaceMessagePushPolicyLinks(policy.id, parsed.data);
    return ok({ policy: messagePushPolicyWithLinks(policy) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export function messagePushPolicyListPayload() {
  const policies = db.select().from(messagePushPolicies).orderBy(messagePushPolicies.name).all();
  const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
  return {
    policies: policies.map(messagePushPolicyWithLinks),
    instances,
  };
}

export function messagePushPolicyWithLinks(policy: MessagePushPolicy) {
  const links = db
    .select()
    .from(messagePushPolicyCpaInstances)
    .where(eq(messagePushPolicyCpaInstances.policyId, policy.id))
    .all();
  return {
    ...policy,
    deliveryType: policy.deliveryType as MessagePushDeliveryType,
    deliveryTypes: deliveryTypesFromStored(policy.deliveryType),
    triggerType: policy.triggerType as MessagePushTriggerType,
    scopeType: policy.scopeType as MessagePushScopeType,
    cpaInstanceIds: links.map((link) => link.cpaInstanceId),
  };
}

export function replaceMessagePushPolicyLinks(
  policyId: number,
  input: Pick<MessagePushPolicyInput, "scopeType" | "cpaInstanceIds">,
) {
  db.delete(messagePushPolicyCpaInstances)
    .where(eq(messagePushPolicyCpaInstances.policyId, policyId))
    .run();

  if (input.scopeType !== "custom") {
    return;
  }

  const cpaInstanceIds = [...new Set(input.cpaInstanceIds)];
  if (cpaInstanceIds.length === 0) {
    return;
  }

  db.insert(messagePushPolicyCpaInstances)
    .values(cpaInstanceIds.map((cpaInstanceId) => ({ policyId, cpaInstanceId })))
    .onConflictDoNothing()
    .run();
}

export function normalizedThreshold(input: Pick<MessagePushPolicyInput, "triggerType" | "thresholdPercent">) {
  return input.triggerType === "account_exception" ? null : input.thresholdPercent ?? null;
}

export function normalizedDeliveryType(input: Pick<MessagePushPolicyInput, "deliveryType" | "deliveryTypes">) {
  return normalizedDeliveryTypes(input).join(",");
}

export function normalizedWebhookUrl(input: Pick<MessagePushPolicyInput, "deliveryType" | "deliveryTypes" | "webhookUrl">) {
  return normalizedDeliveryTypes(input).includes("webhook") ? input.webhookUrl : "";
}

export function normalizedHeadersJson(input: Pick<MessagePushPolicyInput, "deliveryType" | "deliveryTypes" | "headersJson">) {
  return normalizedDeliveryTypes(input).includes("webhook") ? input.headersJson || "{}" : "{}";
}

function normalizedDeliveryTypes(input: Pick<MessagePushPolicyInput, "deliveryType" | "deliveryTypes">) {
  const values = input.deliveryTypes?.length
    ? input.deliveryTypes
    : deliveryTypesFromStored(input.deliveryType);
  return messagePushDeliveryTypes.filter((type) => values.includes(type));
}

function deliveryTypesFromStored(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is MessagePushDeliveryType =>
      (messagePushDeliveryTypes as readonly string[]).includes(item),
    );
}

function isJsonObjectString(value: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
