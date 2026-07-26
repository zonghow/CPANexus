export const claudeUsageUrl = "https://api.anthropic.com/api/oauth/usage";
export const claudeProfileUrl = "https://api.anthropic.com/api/oauth/profile";

export const claudeRequestHeaders = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "anthropic-beta": "oauth-2025-04-20",
} as const;

export function buildClaudeRequestHeaders() {
  return { ...claudeRequestHeaders } as Record<string, string>;
}

export type ClaudeUsageWindow = {
  id: string;
  usedPercent: number | null;
  resetsAt: string | null;
};

export type ClaudeExtraUsage = {
  isEnabled: boolean;
  monthlyLimitCents: number | null;
  usedCredits: number | null;
  usedPercent: number | null;
};

export type ClaudeUsageSummary = {
  fiveHourUsedPercent: number | null;
  fiveHourResetsAt: string | null;
  sevenDayUsedPercent: number | null;
  sevenDayResetsAt: string | null;
  windows: ClaudeUsageWindow[];
  extraUsage: ClaudeExtraUsage | null;
};

const claudeUsageWindowKeys = [
  { key: "five_hour", id: "five-hour" },
  { key: "seven_day", id: "seven-day" },
  { key: "seven_day_oauth_apps", id: "seven-day-oauth-apps" },
  { key: "seven_day_opus", id: "seven-day-opus" },
  { key: "seven_day_sonnet", id: "seven-day-sonnet" },
  { key: "seven_day_cowork", id: "seven-day-cowork" },
  { key: "iguana_necktie", id: "iguana-necktie" },
] as const;

export function parseClaudeUsagePayload(
  payload: unknown,
): Record<string, unknown> | null {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(payload) ? payload : null;
}

export function buildClaudeUsageSummary(
  payload: Record<string, unknown> | null | undefined,
): ClaudeUsageSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const windows: ClaudeUsageWindow[] = [];
  for (const { key, id } of claudeUsageWindowKeys) {
    const window = asRecord(payload[key]);
    if (!window || !("utilization" in window)) {
      continue;
    }
    windows.push({
      id,
      usedPercent: numberOrNull(window.utilization),
      resetsAt: stringOrNull(window.resets_at),
    });
  }

  const fiveHour = windows.find((window) => window.id === "five-hour") ?? null;
  const sevenDay = windows.find((window) => window.id === "seven-day") ?? null;
  const extraUsage = normalizeClaudeExtraUsage(payload.extra_usage);

  if (windows.length === 0 && !extraUsage) {
    return null;
  }

  return {
    fiveHourUsedPercent: fiveHour?.usedPercent ?? null,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDayUsedPercent: sevenDay?.usedPercent ?? null,
    sevenDayResetsAt: sevenDay?.resetsAt ?? null,
    windows,
    extraUsage,
  };
}

/**
 * Map Claude usage into CPA Nexus snapshot fields:
 * - usage5hPercent: five-hour window used %
 * - usageWeekPercent: seven-day window used %
 */
export function claudeUsageToQuotaPercents(summary: ClaudeUsageSummary) {
  const fiveHourUsed = clampPercent(summary.fiveHourUsedPercent);
  const sevenDayUsed = clampPercent(summary.sevenDayUsedPercent);
  const exhausted =
    (fiveHourUsed !== null && fiveHourUsed >= 100) ||
    (sevenDayUsed !== null && sevenDayUsed >= 100);

  return {
    usage5hPercent: fiveHourUsed,
    usageWeekPercent: sevenDayUsed,
    available: !exhausted,
  };
}

export function parseClaudeProfilePayload(
  payload: unknown,
): Record<string, unknown> | null {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(payload) ? payload : null;
}

export function resolveClaudePlanLabel(
  profile: Record<string, unknown> | null,
): string | null {
  if (!profile) {
    return null;
  }
  const account = asRecord(profile.account);
  const organization = asRecord(profile.organization);

  const hasClaudeMax = normalizeFlag(account?.has_claude_max);
  if (hasClaudeMax) {
    return "Max";
  }
  const hasClaudePro = normalizeFlag(account?.has_claude_pro);
  if (hasClaudePro) {
    return "Pro";
  }

  const organizationType = stringOrNull(
    organization?.organization_type,
  )?.toLowerCase();
  const subscriptionStatus = stringOrNull(
    organization?.subscription_status,
  )?.toLowerCase();
  if (organizationType === "claude_team" && subscriptionStatus === "active") {
    return "Team";
  }

  if (hasClaudeMax === false && hasClaudePro === false) {
    return "Free";
  }

  return null;
}

function normalizeClaudeExtraUsage(value: unknown): ClaudeExtraUsage | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const isEnabled = normalizeFlag(record.is_enabled) ?? false;
  return {
    isEnabled,
    monthlyLimitCents: numberOrNull(record.monthly_limit),
    usedCredits: numberOrNull(record.used_credits),
    usedPercent: numberOrNull(record.utilization),
  };
}

function normalizeFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(trimmed)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(trimmed)) {
      return false;
    }
  }
  return undefined;
}

function clampPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
