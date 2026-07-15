export type XaiBillingPeriodType = "weekly" | "monthly" | "unknown";

export type XaiProductUsageSummary = {
  product: string;
  usagePercent: number | null;
};

export type XaiBillingSummary = {
  periodType: XaiBillingPeriodType;
  usagePercent: number | null;
  periodStart?: string;
  periodEnd?: string;
  productUsage: XaiProductUsageSummary[];
  monthlyLimitCents: number | null;
  usedCents: number | null;
  includedUsedCents: number | null;
  onDemandCapCents: number | null;
  onDemandUsedCents: number | null;
  onDemandUsedPercent: number | null;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  usedPercent: number | null;
};

export const xaiBillingWeeklyUrl =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const xaiBillingMonthlyUrl = "https://cli-chat-proxy.grok.com/v1/billing";
export const xaiGrokClientVersion = "0.2.91";
export const xaiGrokUserAgent =
  "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)";

export const xaiRequestHeaders = {
  Authorization: "Bearer $TOKEN$",
  "x-xai-token-auth": "xai-grok-cli",
  "x-grok-client-version": xaiGrokClientVersion,
  accept: "*/*",
  "user-agent": xaiGrokUserAgent,
} as const;

export function buildXaiRequestHeaders(file: Record<string, unknown>) {
  const headers: Record<string, string> = { ...xaiRequestHeaders };
  const userId = resolveXaiUserId(file);
  if (userId) {
    headers["x-userid"] = userId;
  }
  return headers;
}

export function resolveXaiUserId(file: Record<string, unknown>) {
  const metadata = asRecord(file.metadata);
  const attributes = asRecord(file.attributes);
  const oauth = asRecord(file.oauth ?? metadata?.oauth ?? attributes?.oauth);
  const user = asRecord(file.user ?? metadata?.user ?? attributes?.user);
  const candidates = [
    file.sub,
    file.subject,
    file.user_id,
    file.userId,
    metadata?.sub,
    metadata?.subject,
    metadata?.user_id,
    metadata?.userId,
    attributes?.sub,
    attributes?.subject,
    attributes?.user_id,
    attributes?.userId,
    oauth?.sub,
    oauth?.subject,
    user?.sub,
    user?.id,
  ];
  for (const candidate of candidates) {
    const value = stringOrNull(candidate);
    if (value) {
      return value;
    }
  }
  return null;
}

export function parseXaiBillingPayload(payload: unknown): {
  config?: Record<string, unknown> | null;
} | null {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed) as { config?: Record<string, unknown> | null };
    } catch {
      return null;
    }
  }
  if (typeof payload === "object") {
    return payload as { config?: Record<string, unknown> | null };
  }
  return null;
}

export function buildXaiBillingSummary(
  config: Record<string, unknown> | null | undefined,
): XaiBillingSummary | null {
  if (!config || typeof config !== "object") {
    return null;
  }

  const summary = emptyXaiBillingSummary();
  const currentPeriod = asRecord(config.currentPeriod ?? config.current_period);
  const periodType = resolveXaiPeriodType(currentPeriod);
  const creditUsagePercent = numberOrNull(
    config.creditUsagePercent ?? config.credit_usage_percent,
  );
  const periodStart =
    stringOrNull(currentPeriod?.start) ??
    stringOrNull(config.billingPeriodStart ?? config.billing_period_start) ??
    undefined;
  const periodEnd =
    stringOrNull(currentPeriod?.end) ??
    stringOrNull(config.billingPeriodEnd ?? config.billing_period_end) ??
    undefined;
  const productUsage = normalizeXaiProductUsage(
    config.productUsage ?? config.product_usage,
  );

  const monthlyLimitCents = normalizeXaiCentValue(
    config.monthlyLimit ?? config.monthly_limit,
  );
  const usedCents = normalizeXaiCentValue(config.used);
  const onDemandCapCents = normalizeXaiCentValue(
    config.onDemandCap ?? config.on_demand_cap,
  );
  const explicitOnDemandUsedCents = normalizeXaiCentValue(
    config.onDemandUsed ?? config.on_demand_used,
  );
  const billingPeriodStart =
    stringOrNull(config.billingPeriodStart ?? config.billing_period_start) ??
    undefined;
  const billingPeriodEnd =
    stringOrNull(config.billingPeriodEnd ?? config.billing_period_end) ??
    undefined;

  const includedUsedCents =
    usedCents === null
      ? null
      : monthlyLimitCents !== null && monthlyLimitCents > 0
        ? Math.min(usedCents, monthlyLimitCents)
        : usedCents;
  const derivedOnDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null
      ? Math.max(0, usedCents - monthlyLimitCents)
      : null;
  const onDemandUsedCents =
    explicitOnDemandUsedCents ?? derivedOnDemandUsedCents;
  const usedPercent =
    monthlyLimitCents !== null &&
    monthlyLimitCents > 0 &&
    includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null &&
    onDemandCapCents > 0 &&
    onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  const hasWeeklyData =
    creditUsagePercent !== null ||
    periodType === "weekly" ||
    productUsage.length > 0;
  const hasMonthlyData =
    monthlyLimitCents !== null ||
    usedCents !== null ||
    (!hasWeeklyData &&
      (onDemandCapCents !== null || Boolean(billingPeriodEnd)));

  if (!hasWeeklyData && !hasMonthlyData) {
    return null;
  }

  summary.periodType = hasWeeklyData
    ? periodType === "unknown"
      ? "weekly"
      : periodType
    : "monthly";
  summary.usagePercent = hasWeeklyData ? creditUsagePercent : usedPercent;
  summary.periodStart = hasWeeklyData ? periodStart : billingPeriodStart;
  summary.periodEnd = hasWeeklyData ? periodEnd : billingPeriodEnd;
  summary.productUsage = productUsage;
  summary.monthlyLimitCents = monthlyLimitCents;
  summary.usedCents = usedCents;
  summary.includedUsedCents = includedUsedCents;
  summary.onDemandCapCents = onDemandCapCents;
  summary.onDemandUsedCents = onDemandUsedCents;
  summary.onDemandUsedPercent = onDemandUsedPercent;
  summary.billingPeriodStart = hasMonthlyData ? billingPeriodStart : undefined;
  summary.billingPeriodEnd = hasMonthlyData ? billingPeriodEnd : undefined;
  summary.usedPercent = usedPercent;

  return summary;
}

export function mergeXaiBillingSummaries(
  primary: XaiBillingSummary | null,
  fallback: XaiBillingSummary | null,
): XaiBillingSummary | null {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }

  return {
    periodType:
      primary.periodType !== "unknown" ? primary.periodType : fallback.periodType,
    usagePercent: primary.usagePercent ?? fallback.usagePercent,
    periodStart: primary.periodStart ?? fallback.periodStart,
    periodEnd: primary.periodEnd ?? fallback.periodEnd,
    productUsage:
      primary.productUsage.length > 0
        ? primary.productUsage
        : fallback.productUsage,
    monthlyLimitCents: primary.monthlyLimitCents ?? fallback.monthlyLimitCents,
    usedCents: primary.usedCents ?? fallback.usedCents,
    includedUsedCents: primary.includedUsedCents ?? fallback.includedUsedCents,
    onDemandCapCents: primary.onDemandCapCents ?? fallback.onDemandCapCents,
    onDemandUsedCents: primary.onDemandUsedCents ?? fallback.onDemandUsedCents,
    onDemandUsedPercent:
      primary.onDemandUsedPercent ?? fallback.onDemandUsedPercent,
    billingPeriodStart:
      primary.billingPeriodStart ?? fallback.billingPeriodStart,
    billingPeriodEnd: primary.billingPeriodEnd ?? fallback.billingPeriodEnd,
    usedPercent: primary.usedPercent ?? fallback.usedPercent,
  };
}

/**
 * Map Grok billing into CPA Nexus snapshot fields:
 * - usageWeekPercent: weekly credit usage %
 * - usage5hPercent: monthly included credits usage %
 */
export function xaiBillingToQuotaPercents(summary: XaiBillingSummary) {
  const weekUsed =
    summary.periodType === "weekly" || summary.usagePercent !== null
      ? clampPercent(summary.usagePercent)
      : null;
  const monthUsed = clampPercent(summary.usedPercent);
  const exhausted =
    (weekUsed !== null && weekUsed >= 100) ||
    (monthUsed !== null && monthUsed >= 100);

  return {
    usageWeekPercent: weekUsed,
    usage5hPercent: monthUsed,
    available: !exhausted,
    planLabel: resolveXaiPlanLabel(summary.monthlyLimitCents),
  };
}

export function resolveXaiPlanLabel(monthlyLimitCents: number | null) {
  if (monthlyLimitCents === 15_000) {
    return "SuperGrok";
  }
  if (monthlyLimitCents === 150_000) {
    return "SuperGrok Heavy";
  }
  return null;
}

function emptyXaiBillingSummary(): XaiBillingSummary {
  return {
    periodType: "unknown",
    usagePercent: null,
    productUsage: [],
    monthlyLimitCents: null,
    usedCents: null,
    includedUsedCents: null,
    onDemandCapCents: null,
    onDemandUsedCents: null,
    onDemandUsedPercent: null,
    usedPercent: null,
  };
}

function normalizeXaiProductUsage(productUsage: unknown): XaiProductUsageSummary[] {
  if (!Array.isArray(productUsage)) {
    return [];
  }
  return productUsage
    .map((item, index): XaiProductUsageSummary | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const product =
        stringOrNull(record.product) ?? `Product ${index + 1}`;
      const usagePercent = numberOrNull(
        record.usagePercent ?? record.usage_percent,
      );
      return { product, usagePercent };
    })
    .filter((item): item is XaiProductUsageSummary => item !== null);
}

function normalizeXaiCentValue(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return numberOrNull((value as { val?: unknown }).val);
  }
  return numberOrNull(value);
}

function resolveXaiPeriodType(
  period: Record<string, unknown> | null,
): XaiBillingPeriodType {
  const rawType = stringOrNull(period?.type)?.toLowerCase() ?? "";
  if (rawType.includes("weekly")) {
    return "weekly";
  }
  if (rawType.includes("monthly")) {
    return "monthly";
  }
  return "unknown";
}

function clampPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  // Keep at most 2 decimal places to avoid noisy UI numbers.
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
