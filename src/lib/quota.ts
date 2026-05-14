export type NormalizedQuotaSnapshot = {
  email: string | null;
  authFileName: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  available: boolean;
  exception: string | null;
  raw: unknown;
};

const errorWords = [
  "error",
  "expired",
  "invalid",
  "unauthorized",
  "forbidden",
  "refresh",
  "login",
  "disabled",
  "unavailable",
];

export function normalizeQuotaPayload(payload: unknown): NormalizedQuotaSnapshot[] {
  const records = extractRecords(payload);

  return records
    .map((record) => normalizeRecord(record))
    .filter((snapshot) => snapshot.email || snapshot.authFileName);
}

function extractRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["accounts", "quotas", "data", "items", "files", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      for (const nestedKey of ["accounts", "quotas", "items", "files"]) {
        const nested = value[nestedKey];
        if (Array.isArray(nested)) {
          return nested;
        }
      }
    }
  }

  return [payload];
}

function normalizeRecord(record: unknown): NormalizedQuotaSnapshot {
  const obj = isRecord(record) ? record : {};
  const email = firstString(obj, ["email", "account", "account_email", "user", "username"]);
  const authFileName = firstString(obj, ["name", "file", "fileName", "filename", "auth_file"]);
  const exception = extractException(obj);

  return {
    email,
    authFileName,
    usage5hPercent: extractUsagePercent(obj, "5h"),
    usageWeekPercent: extractUsagePercent(obj, "week"),
    available: inferAvailable(obj, exception),
    exception,
    raw: record,
  };
}

function extractUsagePercent(obj: Record<string, unknown>, window: "5h" | "week") {
  const rateLimit = extractRateLimitUsagePercent(obj, window);
  if (rateLimit !== null) {
    return rateLimit;
  }

  const quotaObject = isRecord(obj.quota) ? obj.quota : null;
  const directKeys =
    window === "5h"
      ? ["usage5hPercent", "used5hPercent", "used_5h_percent", "five_hour_usage_percent", "5h_usage_percent"]
      : ["usageWeekPercent", "usedWeekPercent", "used_week_percent", "weekly_usage_percent", "week_usage_percent"];
  const direct = firstNumber(obj, directKeys);
  if (direct !== null) {
    return clampPercent(direct);
  }
  if (quotaObject) {
    const quotaDirect = firstNumber(quotaObject, directKeys);
    if (quotaDirect !== null) {
      return clampPercent(quotaDirect);
    }
  }

  const nestedKeys = window === "5h" ? ["fiveHour", "five_hour", "5h", "h5"] : ["weekly", "week", "7d", "sevenDay"];
  for (const container of [obj, quotaObject]) {
    if (!container) {
      continue;
    }
    for (const key of nestedKeys) {
      const nested = container[key];
      if (!isRecord(nested)) {
        continue;
      }

      const usedPercent = firstNumber(nested, ["used_percent", "usedPercent", "usage_percent", "usagePercent", "percent"]);
      if (usedPercent !== null) {
        return clampPercent(usedPercent);
      }

      const remaining = firstNumber(nested, ["remaining", "remain", "remaining_quota", "remainingQuota"]);
      const limit = firstNumber(nested, ["limit", "total", "quota", "max"]);
      if (remaining !== null && limit !== null && limit > 0) {
        return clampPercent(((limit - remaining) / limit) * 100);
      }
    }
  }

  return null;
}

function extractRateLimitUsagePercent(obj: Record<string, unknown>, window: "5h" | "week") {
  const rateLimitSources = [obj.rate_limit, obj.rateLimits, obj.rate_limits].filter(isRecord);

  for (const source of rateLimitSources) {
    const selectedWindow = selectRateLimitWindow(source, obj, window);
    if (!selectedWindow) {
      continue;
    }

    const usedPercent = firstNumber(selectedWindow, [
      "used_percent",
      "usedPercent",
      "usage_percent",
      "usagePercent",
      "percent",
    ]);
    if (usedPercent !== null) {
      return clampPercent(usedPercent);
    }
  }

  return null;
}

function selectRateLimitWindow(
  rateLimit: Record<string, unknown>,
  obj: Record<string, unknown>,
  window: "5h" | "week",
) {
  const primary = firstRecord(rateLimit, ["primary_window", "primaryWindow", "primary"]);
  const secondary = firstRecord(rateLimit, ["secondary_window", "secondaryWindow", "secondary"]);
  const windows = [primary, secondary].filter((item): item is Record<string, unknown> => item !== null);
  const classified = windows.find((item) => classifyRateLimitWindow(item) === window);
  if (classified) {
    return classified;
  }

  const planType = (
    firstString(obj, ["plan_type", "planType"]) ??
    firstString(rateLimit, ["plan_type", "planType"])
  )?.toLowerCase();
  if (planType === "free") {
    return window === "week" ? primary ?? secondary : null;
  }

  return window === "5h" ? primary : secondary;
}

function classifyRateLimitWindow(window: Record<string, unknown>) {
  const seconds = firstNumber(window, ["limit_window_seconds", "limitWindowSeconds", "window_seconds", "windowSeconds"]);
  const minutes = firstNumber(window, ["window_minutes", "windowMinutes", "limit_window_minutes", "limitWindowMinutes"]);
  const totalSeconds = seconds ?? (minutes !== null ? minutes * 60 : null);
  if (totalSeconds === null || totalSeconds <= 0) {
    return null;
  }

  return totalSeconds >= 24 * 60 * 60 ? "week" : "5h";
}

function extractException(obj: Record<string, unknown>) {
  const value = firstString(obj, ["exception", "error", "message", "status_message", "statusMessage", "reason"]);
  if (!value) {
    return null;
  }

  if (value.toLowerCase() === "ok" || value.toLowerCase() === "active") {
    return null;
  }

  return value;
}

function inferAvailable(obj: Record<string, unknown>, exception: string | null) {
  const explicit = firstBoolean(obj, ["available", "usable", "healthy", "success"]);
  if (explicit !== null) {
    return explicit;
  }

  const rateLimit = isRecord(obj.rate_limit) ? obj.rate_limit : null;
  if (rateLimit) {
    const allowed = firstBoolean(rateLimit, ["allowed"]);
    const limitReached = firstBoolean(rateLimit, ["limit_reached", "limitReached"]);
    if (allowed !== null) {
      return allowed && limitReached !== true;
    }
  }

  const disabled = firstBoolean(obj, ["disabled", "unavailable"]);
  if (disabled !== null) {
    return !disabled;
  }

  const status = firstString(obj, ["status", "state"]);
  const joined = [status, exception].filter(Boolean).join(" ").toLowerCase();
  if (!joined) {
    return true;
  }

  return !errorWords.some((word) => joined.includes(word));
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

function firstNumber(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return null;
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

function firstRecord(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return null;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
