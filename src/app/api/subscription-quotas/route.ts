import { z } from "zod";

import { db } from "@/db/client";
import { subscriptionQuotas } from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";
import { configurableSubscriptionTypes } from "@/lib/subscription";
import { loadSubscriptionQuotaSettings } from "@/lib/subscription-quota";

export const runtime = "nodejs";

const dollarValue = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullable();

const quotaEntrySchema = z.object({
  subscriptionType: z.enum(configurableSubscriptionTypes),
  usage5hDollars: dollarValue,
  usageWeekDollars: dollarValue,
});

const payloadSchema = z.object({
  quotas: z.array(quotaEntrySchema),
});

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    return ok({ quotas: loadSubscriptionQuotaSettings() });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const parsed = payloadSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const now = new Date().toISOString();
    for (const entry of parsed.data.quotas) {
      db.insert(subscriptionQuotas)
        .values({
          subscriptionType: entry.subscriptionType,
          usage5hDollars: entry.usage5hDollars,
          usageWeekDollars: entry.usageWeekDollars,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: subscriptionQuotas.subscriptionType,
          set: {
            usage5hDollars: entry.usage5hDollars,
            usageWeekDollars: entry.usageWeekDollars,
            updatedAt: now,
          },
        })
        .run();
    }

    return ok({ quotas: loadSubscriptionQuotaSettings() });
  } catch (error) {
    return serverError(error);
  }
}
