export function extractSubscriptionType(rawJson: string | null) {
  if (!rawJson) {
    return null;
  }

  try {
    const payload = JSON.parse(rawJson) as unknown;
    if (!isRecord(payload)) {
      return null;
    }

    return (
      firstString(payload, ["plan_type", "planType", "subscription_type", "subscriptionType"]) ??
      (isRecord(payload.rate_limit)
        ? firstString(payload.rate_limit, ["plan_type", "planType", "subscription_type", "subscriptionType"])
        : null) ??
      null
    );
  } catch {
    return null;
  }
}

export function isFreeSubscriptionType(value: string | null) {
  return value?.trim().toLowerCase() === "free";
}

function firstString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
