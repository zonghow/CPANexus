export type QuotaResetTimes = {
  usage5hResetAt: string | null;
  usageWeekResetAt: string | null;
};

type WindowKind = "5h" | "week";

const emptyResetTimes: QuotaResetTimes = {
  usage5hResetAt: null,
  usageWeekResetAt: null,
};

const absoluteResetKeys = [
  "reset_at",
  "resetAt",
  "resets_at",
  "resetsAt",
  "reset_time",
  "resetTime",
  "next_reset_at",
  "nextResetAt",
  "refresh_at",
  "refreshAt",
];

const relativeSecondKeys = [
  "reset_after_seconds",
  "resetAfterSeconds",
  "remaining_seconds",
  "remainingSeconds",
  "seconds_until_reset",
  "secondsUntilReset",
  "reset_in_seconds",
  "resetInSeconds",
];

const relativeMinuteKeys = [
  "reset_after_minutes",
  "resetAfterMinutes",
  "remaining_minutes",
  "remainingMinutes",
  "minutes_until_reset",
  "minutesUntilReset",
  "reset_in_minutes",
  "resetInMinutes",
];

export function extractQuotaResetTimes(
  rawJson: string | null | undefined,
  capturedAt: string | null | undefined,
): QuotaResetTimes {
  const obj = parseRecord(rawJson);
  if (!obj) {
    return { ...emptyResetTimes };
  }

  const capturedMs = parseDateMs(capturedAt);
  const result = { ...emptyResetTimes };

  applyDirectWindow(result, obj, "5h", ["usage5hResetAt", "reset5hAt", "fiveHourResetAt", "five_hour_reset_at", "5h_reset_at"], capturedMs);
  applyDirectWindow(result, obj, "week", ["usageWeekResetAt", "resetWeekAt", "weeklyResetAt", "week_reset_at", "weekly_reset_at"], capturedMs);

  for (const container of [obj, recordOrNull(obj.quota)]) {
    if (!container) {
      continue;
    }

    for (const key of ["fiveHour", "five_hour", "5h", "h5"]) {
      applyWindow(result, "5h", recordOrNull(container[key]), capturedMs);
    }
    for (const key of ["weekly", "week", "7d", "sevenDay"]) {
      applyWindow(result, "week", recordOrNull(container[key]), capturedMs);
    }
  }

  const planType = firstString(obj, ["plan_type", "planType"])?.toLowerCase() ?? null;
  for (const source of [obj.rate_limit, obj.rateLimits, obj.rate_limits].map(recordOrNull)) {
    if (!source) {
      continue;
    }

    const primary = firstRecord(source, ["primary_window", "primaryWindow", "primary"]);
    const secondary = firstRecord(source, ["secondary_window", "secondaryWindow", "secondary"]);
    const windows = [primary, secondary].filter((item): item is Record<string, unknown> => item !== null);
    for (const window of windows) {
      const kind = classifyWindow(window);
      if (kind) {
        applyWindow(result, kind, window, capturedMs);
      }
    }

    if (planType === "free") {
      applyWindow(result, "week", primary ?? secondary, capturedMs);
    } else {
      applyWindow(result, "5h", primary, capturedMs);
      applyWindow(result, "week", secondary, capturedMs);
    }
  }

  return result;
}

function applyDirectWindow(
  result: QuotaResetTimes,
  obj: Record<string, unknown>,
  kind: WindowKind,
  keys: string[],
  capturedMs: number | null,
) {
  if (readResult(result, kind)) {
    return;
  }

  const resetAt = absoluteFromFirstValue(obj, keys) ?? relativeFromFirstValue(obj, keys, capturedMs);
  if (resetAt) {
    writeResult(result, kind, resetAt);
  }
}

function applyWindow(
  result: QuotaResetTimes,
  kind: WindowKind,
  window: Record<string, unknown> | null,
  capturedMs: number | null,
) {
  if (!window || readResult(result, kind)) {
    return;
  }

  const resetAt = readWindowResetAt(window, capturedMs);
  if (resetAt) {
    writeResult(result, kind, resetAt);
  }
}

function readWindowResetAt(window: Record<string, unknown>, capturedMs: number | null) {
  return (
    absoluteFromFirstValue(window, absoluteResetKeys) ??
    relativeFromFirstValue(window, relativeSecondKeys, capturedMs) ??
    relativeFromFirstValue(window, relativeMinuteKeys, capturedMs, 60)
  );
}

function absoluteFromFirstValue(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    const parsed = parseAbsoluteReset(value);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function relativeFromFirstValue(
  obj: Record<string, unknown>,
  keys: string[],
  capturedMs: number | null,
  multiplier = 1,
) {
  if (capturedMs === null) {
    return null;
  }

  for (const key of keys) {
    const value = numberOrNull(obj[key]);
    if (value !== null && value >= 0) {
      return new Date(capturedMs + value * multiplier * 1000).toISOString();
    }
  }

  return null;
}

function classifyWindow(window: Record<string, unknown>): WindowKind | null {
  const seconds = firstNumber(window, ["limit_window_seconds", "limitWindowSeconds", "window_seconds", "windowSeconds"]);
  const minutes = firstNumber(window, ["window_minutes", "windowMinutes", "limit_window_minutes", "limitWindowMinutes"]);
  const totalSeconds = seconds ?? (minutes !== null ? minutes * 60 : null);
  if (totalSeconds === null || totalSeconds <= 0) {
    return null;
  }

  return totalSeconds >= 24 * 60 * 60 ? "week" : "5h";
}

function parseAbsoluteReset(value: unknown) {
  if (typeof value === "string" && value.trim() && !Number.isFinite(Number(value))) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  const numeric = numberOrNull(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }

  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(ms).toISOString();
}

function readResult(result: QuotaResetTimes, kind: WindowKind) {
  return kind === "5h" ? result.usage5hResetAt : result.usageWeekResetAt;
}

function writeResult(result: QuotaResetTimes, kind: WindowKind, resetAt: string) {
  if (kind === "5h") {
    result.usage5hResetAt = resetAt;
  } else {
    result.usageWeekResetAt = resetAt;
  }
}

function parseRecord(rawJson: string | null | undefined) {
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return recordOrNull(parsed);
  } catch {
    return null;
  }
}

function firstRecord(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = recordOrNull(obj[key]);
    if (value) {
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

function firstNumber(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = numberOrNull(obj[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function parseDateMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
