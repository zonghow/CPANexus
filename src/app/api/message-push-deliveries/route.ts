import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  cpaInstances,
  messagePushDeliveries,
  messagePushPolicies,
} from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const url = new URL(request.url);
    const requestedPage = parsePositiveInteger(url.searchParams.get("page")) ?? 1;
    const pageSize = Math.min(
      100,
      Math.max(10, parsePositiveInteger(url.searchParams.get("pageSize")) ?? 20),
    );
    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(messagePushDeliveries)
      .get()?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = db
      .select({
        id: messagePushDeliveries.id,
        policyId: messagePushDeliveries.policyId,
        policyName: messagePushPolicies.name,
        cpaInstanceId: messagePushDeliveries.cpaInstanceId,
        cpaInstanceName: cpaInstances.name,
        deliveryType: messagePushDeliveries.deliveryType,
        triggerKey: messagePushDeliveries.triggerKey,
        status: messagePushDeliveries.status,
        message: messagePushDeliveries.message,
        responseStatus: messagePushDeliveries.responseStatus,
        responseBody: messagePushDeliveries.responseBody,
        error: messagePushDeliveries.error,
        sentAt: messagePushDeliveries.sentAt,
      })
      .from(messagePushDeliveries)
      .leftJoin(
        messagePushPolicies,
        eq(messagePushPolicies.id, messagePushDeliveries.policyId),
      )
      .leftJoin(
        cpaInstances,
        eq(cpaInstances.id, messagePushDeliveries.cpaInstanceId),
      )
      .orderBy(desc(messagePushDeliveries.sentAt), desc(messagePushDeliveries.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    return ok({
      deliveries: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
