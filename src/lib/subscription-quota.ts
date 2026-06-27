import { db } from "@/db/client";
import { subscriptionQuotas } from "@/db/schema";

import { configurableSubscriptionTypes } from "./subscription";
import type { SubscriptionQuotaSetting } from "./quota-summary";

/**
 * Loads the configured per-subscription-type dollar quotas, always returning
 * every configurable type with blanks for unset entries. This is the single
 * source the API, account page, and message push read from.
 */
export function loadSubscriptionQuotaSettings(): SubscriptionQuotaSetting[] {
  const stored = new Map(
    db
      .select()
      .from(subscriptionQuotas)
      .all()
      .map((row) => [row.subscriptionType, row]),
  );

  return configurableSubscriptionTypes.map((subscriptionType) => {
    const row = stored.get(subscriptionType);
    return {
      subscriptionType,
      usage5hDollars: row?.usage5hDollars ?? null,
      usageWeekDollars: row?.usageWeekDollars ?? null,
    };
  });
}
