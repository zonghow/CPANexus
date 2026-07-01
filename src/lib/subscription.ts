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
      planTypeFromAuthTokens(payload) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Auth-file payloads don't carry a plan_type field, but the OpenAI/Codex
 * access/id tokens embed `chatgpt_plan_type` under the
 * `https://api.openai.com/auth` claim. Decoding the (locally readable) JWT lets
 * us recover the subscription type even for dead accounts whose quota probe
 * failed, so notifications and listings don't fall back to "未知".
 */
function planTypeFromAuthTokens(payload: Record<string, unknown>) {
  for (const key of ["access_token", "id_token", "accessToken", "idToken"]) {
    const token = payload[key];
    if (typeof token !== "string" || !token) {
      continue;
    }
    const claims = decodeJwtPayload(token);
    const authClaim = claims && isRecord(claims["https://api.openai.com/auth"])
      ? claims["https://api.openai.com/auth"]
      : null;
    const plan = authClaim
      ? firstString(authClaim, ["chatgpt_plan_type", "chatgptPlanType", "plan_type", "planType"])
      : null;
    if (plan) {
      return plan;
    }
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("binary");
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : null;
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
