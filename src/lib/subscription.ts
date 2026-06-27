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

export const configurableSubscriptionTypes = [
  "plus",
  "k12",
  "team",
  "go",
  "pro_5x",
  "pro_20x",
] as const;

export type ConfigurableSubscriptionType =
  (typeof configurableSubscriptionTypes)[number];

export const configurableSubscriptionLabels: Record<
  ConfigurableSubscriptionType,
  string
> = {
  plus: "Plus",
  k12: "K12",
  team: "Team",
  go: "Go",
  pro_5x: "Pro 5X",
  pro_20x: "Pro 20X",
};

/**
 * Maps a raw subscription type string from the CPA payload to the canonical
 * key used by the quota settings. Returns null for types that are not
 * configurable (e.g. free), so callers can fall back to default behaviour.
 */
export function normalizeSubscriptionType(
  value: string | null,
): ConfigurableSubscriptionType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized === "pro" ||
    normalized === "pro20x" ||
    normalized === "pro-20x" ||
    normalized === "pro_20x"
  ) {
    return "pro_20x";
  }

  if (
    normalized === "prolite" ||
    normalized === "pro-lite" ||
    normalized === "pro_lite" ||
    normalized === "pro5x" ||
    normalized === "pro-5x" ||
    normalized === "pro_5x"
  ) {
    return "pro_5x";
  }

  if (normalized === "plus") {
    return "plus";
  }
  if (normalized === "k12") {
    return "k12";
  }
  if (normalized === "team") {
    return "team";
  }
  if (normalized === "go") {
    return "go";
  }

  return null;
}

export function subscriptionAverageWeight(value: string | null) {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "pro" ||
    normalized === "pro20x" ||
    normalized === "pro-20x" ||
    normalized === "pro_20x"
  ) {
    return 20;
  }

  if (
    normalized === "prolite" ||
    normalized === "pro-lite" ||
    normalized === "pro_lite" ||
    normalized === "pro5x" ||
    normalized === "pro-5x" ||
    normalized === "pro_5x"
  ) {
    return 5;
  }

  return 1;
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
