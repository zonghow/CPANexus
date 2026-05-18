import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { messagePushPolicies } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  parseIntegerId,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";

import {
  messagePushPolicySchema,
  messagePushPolicyWithLinks,
  normalizedDeliveryType,
  normalizedHeadersJson,
  normalizedThreshold,
  normalizedWebhookUrl,
  replaceMessagePushPolicyLinks,
} from "../route";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const { id: rawId } = await routeParams(context);
    const id = parseIntegerId(rawId);
    if (!id) {
      return badRequest("invalid id");
    }
    const parsed = messagePushPolicySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const policy = db
      .update(messagePushPolicies)
      .set({
        name: parsed.data.name,
        deliveryType: normalizedDeliveryType(parsed.data),
        triggerType: parsed.data.triggerType,
        thresholdPercent: normalizedThreshold(parsed.data),
        scopeType: parsed.data.scopeType,
        webhookUrl: normalizedWebhookUrl(parsed.data),
        headersJson: normalizedHeadersJson(parsed.data),
        bodyTemplate: parsed.data.bodyTemplate,
        enabled: parsed.data.enabled,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(messagePushPolicies.id, id))
      .returning()
      .get();

    if (!policy) {
      return notFound("message push policy not found");
    }

    replaceMessagePushPolicyLinks(policy.id, parsed.data);
    return ok({ policy: messagePushPolicyWithLinks(policy) });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const { id: rawId } = await routeParams(context);
    const id = parseIntegerId(rawId);
    if (!id) {
      return badRequest("invalid id");
    }

    db.delete(messagePushPolicies)
      .where(eq(messagePushPolicies.id, id))
      .run();
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
