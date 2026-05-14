export type AccountQuotaState = "available" | "limited" | "exception" | "disabled";

export type AccountQuotaStatus = {
  state: AccountQuotaState;
  label: string;
};

export function resolveAccountQuotaStatus(input: {
  disabled: boolean;
  available: boolean;
  exception: string | null;
  rawJson: string | null;
}): AccountQuotaStatus {
  if (input.disabled) {
    return { state: "disabled", label: "停用" };
  }

  if (input.exception) {
    return { state: "exception", label: input.exception };
  }

  if (!input.available) {
    return isRateLimitReached(input.rawJson)
      ? { state: "limited", label: "限额" }
      : { state: "exception", label: "异常" };
  }

  return { state: "available", label: "可用" };
}

function isRateLimitReached(rawJson: string | null) {
  if (!rawJson) {
    return false;
  }

  try {
    const payload = JSON.parse(rawJson) as unknown;
    if (!isRecord(payload)) {
      return false;
    }

    const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : null;
    const limitReached = rateLimit ? firstBoolean(rateLimit, ["limit_reached", "limitReached"]) : null;
    if (limitReached === true) {
      return true;
    }

    const reachedType = isRecord(payload.rate_limit_reached_type)
      ? firstString(payload.rate_limit_reached_type, ["type"])
      : null;

    return reachedType === "rate_limit_reached";
  } catch {
    return false;
  }
}

function firstBoolean(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
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
