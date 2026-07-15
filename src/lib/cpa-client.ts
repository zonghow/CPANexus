import type { CpaInstance } from "@/db/schema";

import { matchesAuthView } from "./auth-provider";
import { normalizeQuotaPayload, type NormalizedQuotaSnapshot } from "./quota";
import {
  buildXaiBillingSummary,
  buildXaiRequestHeaders,
  mergeXaiBillingSummaries,
  parseXaiBillingPayload,
  xaiBillingMonthlyUrl,
  xaiBillingToQuotaPercents,
  xaiBillingWeeklyUrl,
  type XaiBillingSummary,
} from "./xai-quota";

export type CpaConnection = Pick<
  CpaInstance,
  "id" | "name" | "baseUrl" | "password" | "quotaRefreshPath"
>;

export type RemoteAuthFile = {
  id?: string;
  auth_index?: string;
  account_id?: string;
  name: string;
  email?: string;
  type?: string;
  provider?: string;
  label?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
  proxy_url?: string;
  size?: number;
  id_token?: string | {
    chatgpt_account_id?: string;
    chatgptAccountId?: string;
    account_id?: string;
    accountId?: string;
    plan_type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const defaultHeaders = {
  accept: "application/json",
};
const defaultQuotaRefreshPath = "/v0/management/auth-files";
const codexWhamUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const quotaProbeConcurrency = 6;

export async function listRemoteAuthFiles(instance: CpaConnection) {
  const payload = await cpaFetchJson<{ files?: RemoteAuthFile[] }>(
    instance,
    "/v0/management/auth-files",
  );

  return Array.isArray(payload.files) ? payload.files : [];
}

export async function downloadRemoteAuthFile(
  instance: CpaConnection,
  fileName: string,
) {
  return cpaFetchJson<unknown>(
    instance,
    `/v0/management/auth-files/download?name=${encodeURIComponent(fileName)}`,
  );
}

export async function uploadRemoteAuthFile(
  instance: CpaConnection,
  fileName: string,
  payload: unknown,
) {
  await cpaFetchJson(
    instance,
    `/v0/management/auth-files?name=${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteRemoteAuthFile(
  instance: CpaConnection,
  fileName: string,
) {
  await cpaFetchJson(
    instance,
    `/v0/management/auth-files?name=${encodeURIComponent(fileName)}`,
    {
      method: "DELETE",
    },
  );
}

export async function patchRemoteAuthFileFields(
  instance: CpaConnection,
  fileName: string,
  fields: { proxy_url?: string | null; note?: string | null },
) {
  await cpaFetchJson(instance, "/v0/management/auth-files/fields", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: fileName,
      ...fields,
    }),
  });
}

export async function setRemoteAuthFileDisabled(
  instance: CpaConnection,
  fileName: string,
  disabled: boolean,
) {
  await cpaFetchJson(instance, "/v0/management/auth-files/status", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: fileName,
      disabled,
    }),
  });
}

export async function startCodexOAuth(instance: CpaConnection) {
  const payload = await cpaFetchJson<{
    auth_url?: string;
    authUrl?: string;
    url?: string;
    state?: string;
    error?: string;
  }>(instance, "/v0/management/codex-auth-url?is_webui=true");

  if (payload.error) {
    throw new Error(payload.error);
  }

  const authUrl =
    stringOrNull(payload.auth_url) ??
    stringOrNull(payload.authUrl) ??
    stringOrNull(payload.url);
  if (!authUrl) {
    throw new Error("CPA did not return a Codex OAuth login URL");
  }

  return {
    authUrl,
    state: stringOrNull(payload.state),
  };
}

export async function submitCodexOAuthCallback(
  instance: CpaConnection,
  redirectUrl: string,
) {
  const payload = await cpaFetchJson<{
    success?: boolean;
    error?: string;
  }>(instance, "/v0/management/oauth-callback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: "codex",
      redirect_url: redirectUrl,
    }),
  });

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (payload.success === false) {
    throw new Error("Codex OAuth callback failed");
  }
}

export async function refreshRemoteQuotas(
  instance: CpaConnection,
  remoteAuthFiles?: RemoteAuthFile[],
): Promise<NormalizedQuotaSnapshot[]> {
  const path = instance.quotaRefreshPath?.trim() || defaultQuotaRefreshPath;
  if (usesCodexWhamQuotaProbe(path)) {
    const files = remoteAuthFiles ?? (await listRemoteAuthFiles(instance));
    return refreshCodexWhamQuotas(instance, files);
  }

  const payload = await cpaFetchJson<unknown>(instance, path);
  return normalizeQuotaPayload(payload);
}

export async function refreshRemoteXaiQuotas(
  instance: CpaConnection,
  remoteAuthFiles?: RemoteAuthFile[],
): Promise<NormalizedQuotaSnapshot[]> {
  const files = remoteAuthFiles ?? (await listRemoteAuthFiles(instance));
  const xaiFiles = files.filter((file) =>
    matchesAuthView(stringOrNull(file.provider) ?? stringOrNull(file.type), "grok", {
      treatMissingAsCodex: false,
    }),
  );

  const batches: NormalizedQuotaSnapshot[][] = [];
  for (let index = 0; index < xaiFiles.length; index += quotaProbeConcurrency) {
    const batch = xaiFiles.slice(index, index + quotaProbeConcurrency);
    batches.push(
      ...(await Promise.all(
        batch.map((file) => probeXaiBillingUsage(instance, file)),
      )),
    );
  }

  return batches.flat();
}

async function refreshCodexWhamQuotas(
  instance: CpaConnection,
  remoteAuthFiles: RemoteAuthFile[],
) {
  const probeTargets = remoteAuthFiles
    .map((file) => ({
      file,
      authIndex: stringOrNull(file.auth_index),
      accountId: codexAccountId(file),
    }))
    .filter((target) => target.authIndex);

  const batches: NormalizedQuotaSnapshot[][] = [];
  for (let index = 0; index < probeTargets.length; index += quotaProbeConcurrency) {
    const batch = probeTargets.slice(index, index + quotaProbeConcurrency);
    batches.push(
      ...(await Promise.all(
        batch.map((target) =>
          probeCodexWhamUsage(instance, target.file, target.authIndex!, target.accountId!),
        ),
      )),
    );
  }

  return batches.flat();
}

async function probeCodexWhamUsage(
  instance: CpaConnection,
  authFile: RemoteAuthFile,
  authIndex: string,
  accountId: string | null,
): Promise<NormalizedQuotaSnapshot[]> {
  try {
    const header: Record<string, string> = {
      Authorization: "Bearer $TOKEN$",
      "chatgpt-account-id": accountId ?? "",
      originator: "codex_cli_rs",
      Accept: "application/json",
    };
    if (!accountId) {
      delete header["chatgpt-account-id"];
    }

    const response = await cpaFetchJson<{
      status_code?: number;
      body?: string;
    }>(instance, "/v0/management/api-call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        auth_index: authIndex,
        method: "GET",
        url: codexWhamUsageUrl,
        header,
      }),
    });
    const upstreamStatus = response.status_code ?? 0;
    const body = parseJson(response.body ?? "");

    if (upstreamStatus < 200 || upstreamStatus >= 300) {
      return [
        quotaProbeFailure(
          authFile,
          `Codex usage ${upstreamStatus || "error"}: ${extractErrorMessage(body)}`,
          body,
        ),
      ];
    }

    const snapshots = normalizeQuotaPayload(enrichQuotaPayload(body, authFile));
    if (snapshots.length > 0) {
      return snapshots;
    }

    return [
      quotaProbeFailure(
        authFile,
        "Codex usage response did not include quota fields",
        body,
      ),
    ];
  } catch (error) {
    return [
      quotaProbeFailure(
        authFile,
        error instanceof Error ? error.message : String(error),
        null,
      ),
    ];
  }
}

async function probeXaiBillingUsage(
  instance: CpaConnection,
  authFile: RemoteAuthFile,
): Promise<NormalizedQuotaSnapshot[]> {
  const authIndex = stringOrNull(authFile.auth_index);
  if (!authIndex) {
    return [
      quotaProbeFailure(authFile, "Grok 账号缺少 auth_index，无法查询额度", null),
    ];
  }

  try {
    const header = buildXaiRequestHeaders(authFile as Record<string, unknown>);
    const [weeklyResult, monthlyResult] = await Promise.allSettled([
      requestXaiBilling(instance, authIndex, xaiBillingWeeklyUrl, header),
      requestXaiBilling(instance, authIndex, xaiBillingMonthlyUrl, header),
    ]);

    const weeklySummary =
      weeklyResult.status === "fulfilled" ? weeklyResult.value : null;
    const monthlySummary =
      monthlyResult.status === "fulfilled" ? monthlyResult.value : null;
    const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);

    if (!summary) {
      if (
        weeklyResult.status === "rejected" &&
        monthlyResult.status === "rejected"
      ) {
        throw weeklyResult.reason;
      }
      return [
        quotaProbeFailure(authFile, "Grok billing 未返回可用额度数据", {
          weekly: weeklySummary,
          monthly: monthlySummary,
        }),
      ];
    }

    const percents = xaiBillingToQuotaPercents(summary);
    return [
      {
        email: stringOrNull(authFile.email),
        authFileName: stringOrNull(authFile.name),
        usage5hPercent: percents.usage5hPercent,
        usageWeekPercent: percents.usageWeekPercent,
        available: percents.available,
        exception: percents.available ? null : "额度已用尽",
        raw: {
          provider: "xai",
          plan: percents.planLabel,
          billing: summary,
        },
      },
    ];
  } catch (error) {
    return [
      quotaProbeFailure(
        authFile,
        error instanceof Error ? error.message : String(error),
        null,
      ),
    ];
  }
}

async function requestXaiBilling(
  instance: CpaConnection,
  authIndex: string,
  url: string,
  header: Record<string, string>,
): Promise<XaiBillingSummary | null> {
  const response = await cpaFetchJson<{
    status_code?: number;
    body?: string;
  }>(instance, "/v0/management/api-call", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      auth_index: authIndex,
      method: "GET",
      url,
      header,
    }),
  });

  const upstreamStatus = response.status_code ?? 0;
  const body = parseJson(response.body ?? "");
  if (upstreamStatus < 200 || upstreamStatus >= 300) {
    throw new Error(
      `Grok billing ${upstreamStatus || "error"}: ${extractErrorMessage(body)}`,
    );
  }

  const payload = parseXaiBillingPayload(body);
  const config = isRecord(payload?.config)
    ? (payload?.config as Record<string, unknown>)
    : isRecord(payload)
      ? (payload as Record<string, unknown>)
      : null;
  return buildXaiBillingSummary(config);
}

async function cpaFetchJson<T = unknown>(
  instance: CpaConnection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(joinCpaUrl(instance.baseUrl, path), {
    ...init,
    headers: {
      ...defaultHeaders,
      authorization: `Bearer ${instance.password}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : text || response.statusText;
    throw new Error(`CPA ${instance.name} ${response.status}: ${message}`);
  }

  return payload as T;
}

function joinCpaUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function parseJson(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function usesCodexWhamQuotaProbe(path: string) {
  const normalized = path.trim().replace(/\/+$/, "");
  return normalized === defaultQuotaRefreshPath || normalized === "codex-wham";
}

function codexAccountId(file: RemoteAuthFile) {
  const idToken = idTokenRecord(file.id_token);
  return (
    stringOrNull(file.account_id) ??
    stringOrNull(idToken?.chatgpt_account_id) ??
    stringOrNull(idToken?.chatgptAccountId) ??
    stringOrNull(idToken?.account_id) ??
    stringOrNull(idToken?.accountId)
  );
}

function idTokenRecord(value: RemoteAuthFile["id_token"]) {
  if (!value) {
    return null;
  }
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsedJson = parseJson(trimmed);
  if (isRecord(parsedJson) && !("raw" in parsedJson)) {
    return parsedJson;
  }

  const payload = trimmed.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function enrichQuotaPayload(payload: unknown, authFile: RemoteAuthFile) {
  const fallback = {
    email: stringOrNull(authFile.email),
    name: stringOrNull(authFile.name),
    auth_file: stringOrNull(authFile.name),
  };
  if (Array.isArray(payload)) {
    return payload.map((item) => (isRecord(item) ? { ...fallback, ...item } : item));
  }
  if (isRecord(payload)) {
    return { ...fallback, ...payload };
  }

  return fallback;
}

function quotaProbeFailure(
  authFile: RemoteAuthFile,
  exception: string,
  raw: unknown,
): NormalizedQuotaSnapshot {
  return {
    email: stringOrNull(authFile.email),
    authFileName: stringOrNull(authFile.name),
    usage5hPercent: null,
    usageWeekPercent: null,
    available: false,
    exception,
    raw,
  };
}

function extractErrorMessage(payload: unknown) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    if (isRecord(payload.error)) {
      const message = stringOrNull(payload.error.message);
      if (message) {
        return message;
      }
    }
    const message = stringOrNull(payload.message);
    if (message) {
      return message;
    }
    const raw = stringOrNull(payload.raw);
    if (raw) {
      return raw;
    }
  }

  return typeof payload === "string" && payload.trim() ? payload.trim() : "unknown error";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
