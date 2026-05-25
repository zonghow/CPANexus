import { normalizeQuotaPayload, type NormalizedQuotaSnapshot } from "./quota";
import { refreshOpenAiToken, type OpenAiTokenResponse } from "./rt-login";

export type CandidateAuthFileForQuota = {
  fileName: string;
  email: string | null;
  rawJson: string;
};

export type CandidateQuotaRefreshResult = {
  snapshot: NormalizedQuotaSnapshot;
  authJson: Record<string, unknown>;
};

export type CandidateTokenRefreshResult = {
  authJson: Record<string, unknown>;
  email: string | null;
  refreshTokenRotated: boolean;
};

const codexWhamUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const codexOriginator = "codex_cli_rs";
const codexUserAgent = "codex-cli/0.91.0";

export async function refreshCandidateAuthFileQuota(
  authFile: CandidateAuthFileForQuota,
  options: {
    fetchImpl?: typeof fetch;
    now?: Date;
    refreshAccessToken?: boolean;
  } = {},
): Promise<CandidateQuotaRefreshResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const refreshAccessToken = options.refreshAccessToken ?? true;
  const parsed = parseRecord(authFile.rawJson);
  if (!parsed) {
    return failure(authFile, "invalid CPA auth JSON", null, {});
  }

  let authJson = parsed;
  let refreshed = false;
  if (
    refreshAccessToken &&
    (!stringOrNull(authJson.access_token) || isExpired(authJson.expired, now))
  ) {
    const refreshResult = await refreshAuthJson(authJson, authFile, now, fetchImpl);
    authJson = refreshResult.authJson;
    refreshed = true;
  }

  let result = await probeWhamUsage(authFile, authJson, fetchImpl);
  if (
    refreshAccessToken &&
    result.snapshot.exception &&
    !refreshed &&
    stringOrNull(authJson.refresh_token)
  ) {
    const refreshResult = await refreshAuthJson(authJson, authFile, now, fetchImpl);
    authJson = refreshResult.authJson;
    result = await probeWhamUsage(authFile, authJson, fetchImpl);
  }

  return {
    snapshot: result.snapshot,
    authJson,
  };
}

export async function refreshCandidateAuthFileToken(
  authFile: CandidateAuthFileForQuota,
  options: {
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {},
): Promise<CandidateTokenRefreshResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const authJson = parseRecord(authFile.rawJson);
  if (!authJson) {
    throw new Error("invalid CPA auth JSON");
  }

  const refreshToken = stringOrNull(authJson.refresh_token);
  if (!refreshToken) {
    throw new Error("missing refresh_token");
  }

  const tokenResponse = await refreshOpenAiToken(refreshToken, {
    clientId: stringOrNull(authJson.client_id) ?? undefined,
    fetchImpl,
  });
  if (!stringOrNull(tokenResponse.access_token)) {
    throw new Error("token response missing access_token");
  }

  const nextAuthJson = buildRefreshedAuthJson(authJson, refreshToken, tokenResponse, now);
  return {
    authJson: nextAuthJson,
    email: stringOrNull(nextAuthJson.email) ?? authFile.email,
    refreshTokenRotated:
      Boolean(stringOrNull(tokenResponse.refresh_token)) &&
      stringOrNull(tokenResponse.refresh_token) !== refreshToken,
  };
}

async function refreshAuthJson(
  authJson: Record<string, unknown>,
  authFile: CandidateAuthFileForQuota,
  now: Date,
  fetchImpl: typeof fetch,
) {
  const refreshToken = stringOrNull(authJson.refresh_token);
  if (!refreshToken) {
    return failure(authFile, "missing access_token and refresh_token", null, authJson);
  }

  try {
    const tokenResponse = await refreshOpenAiToken(refreshToken, {
      clientId: stringOrNull(authJson.client_id) ?? undefined,
      fetchImpl,
    });
    const nextAuthJson = buildRefreshedAuthJson(authJson, refreshToken, tokenResponse, now);

    return {
      snapshot: quotaProbeFailure(authFile, "", null),
      authJson: nextAuthJson,
    };
  } catch (error) {
    return failure(authFile, errorMessage(error), null, authJson);
  }
}

function buildRefreshedAuthJson(
  authJson: Record<string, unknown>,
  refreshToken: string,
  tokenResponse: OpenAiTokenResponse,
  now: Date,
) {
  const idClaims = decodeJwtPayload(stringOrNull(tokenResponse.id_token));
  const openAiAuth = recordOrEmpty(idClaims?.["https://api.openai.com/auth"]);
  const expiresAt = expiresAtIso(tokenResponse.expires_in, tokenResponse.expires_at, idClaims?.exp, now);
  return stripUndefined({
    ...authJson,
    access_token: stringOrNull(tokenResponse.access_token) ?? authJson.access_token,
    id_token: stringOrNull(tokenResponse.id_token) ?? authJson.id_token,
    refresh_token: stringOrNull(tokenResponse.refresh_token) ?? refreshToken,
    expired: expiresAt ?? authJson.expired,
    last_refresh: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    email: stringOrNull(authJson.email) ?? stringOrNull(tokenResponse.email) ?? stringOrNull(idClaims?.email),
    account_id:
      stringOrNull(authJson.account_id) ??
      stringOrNull(openAiAuth.chatgpt_account_id) ??
      stringOrNull(idClaims?.account_id) ??
      stringOrNull(idClaims?.sub),
    chatgpt_account_id:
      stringOrNull(authJson.chatgpt_account_id) ??
      stringOrNull(openAiAuth.chatgpt_account_id) ??
      stringOrNull(idClaims?.account_id) ??
      stringOrNull(idClaims?.sub),
    plan_type:
      stringOrNull(authJson.plan_type) ??
      stringOrNull(openAiAuth.chatgpt_plan_type) ??
      stringOrNull(openAiAuth.plan_type) ??
      stringOrNull(idClaims?.plan_type),
    type: stringOrNull(authJson.type) ?? "codex",
  });
}

async function probeWhamUsage(
  authFile: CandidateAuthFileForQuota,
  authJson: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<CandidateQuotaRefreshResult> {
  const accessToken = stringOrNull(authJson.access_token);
  if (!accessToken) {
    return failure(authFile, "missing access_token", null, authJson);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
    originator: codexOriginator,
    "user-agent": codexUserAgent,
  };
  const accountId = codexAccountId(authJson);
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }

  try {
    const response = await fetchImpl(codexWhamUsageUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      return failure(authFile, `Codex usage ${response.status}: ${extractErrorMessage(payload)}`, payload, authJson);
    }

    const snapshots = normalizeQuotaPayload(enrichQuotaPayload(payload, authFile));
    const snapshot = selectBestSnapshot(authFile, snapshots);
    if (snapshot) {
      return { snapshot, authJson };
    }

    return failure(authFile, "Codex usage response did not include quota fields", payload, authJson);
  } catch (error) {
    return failure(authFile, errorMessage(error), null, authJson);
  }
}

function selectBestSnapshot(
  authFile: CandidateAuthFileForQuota,
  snapshots: NormalizedQuotaSnapshot[],
) {
  const email = authFile.email?.toLowerCase() ?? null;
  return snapshots.find((snapshot) => snapshot.authFileName === authFile.fileName) ??
    (email ? snapshots.find((snapshot) => snapshot.email?.toLowerCase() === email) : undefined) ??
    snapshots[0] ??
    null;
}

function failure(
  authFile: CandidateAuthFileForQuota,
  exception: string,
  raw: unknown,
  authJson: Record<string, unknown>,
): CandidateQuotaRefreshResult {
  return {
    snapshot: quotaProbeFailure(authFile, exception, raw),
    authJson,
  };
}

function quotaProbeFailure(
  authFile: CandidateAuthFileForQuota,
  exception: string,
  raw: unknown,
): NormalizedQuotaSnapshot {
  return {
    email: authFile.email,
    authFileName: authFile.fileName,
    usage5hPercent: null,
    usageWeekPercent: null,
    available: false,
    exception,
    raw,
  };
}

function enrichQuotaPayload(payload: unknown, authFile: CandidateAuthFileForQuota) {
  const fallback = {
    email: authFile.email,
    name: authFile.fileName,
    auth_file: authFile.fileName,
  };
  if (Array.isArray(payload)) {
    return payload.map((item) => (isRecord(item) ? { ...fallback, ...item } : item));
  }
  if (isRecord(payload)) {
    return { ...fallback, ...payload };
  }
  return fallback;
}

function isExpired(value: unknown, now: Date) {
  const text = stringOrNull(value);
  if (!text) {
    return false;
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() + 60_000;
}

function expiresAtIso(expiresIn: unknown, expiresAt: unknown, jwtExp: unknown, now: Date) {
  const expiresInSeconds = numberOrNull(expiresIn);
  if (expiresInSeconds !== null) {
    return new Date(now.getTime() + expiresInSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  const expiresAtSeconds = numberOrNull(expiresAt) ?? numberOrNull(jwtExp);
  if (expiresAtSeconds !== null) {
    return new Date(expiresAtSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  return null;
}

function codexAccountId(authJson: Record<string, unknown>) {
  const idToken = decodeJwtPayload(stringOrNull(authJson.id_token));
  const auth = recordOrEmpty(idToken?.["https://api.openai.com/auth"]);
  return (
    stringOrNull(authJson.account_id) ??
    stringOrNull(authJson.chatgpt_account_id) ??
    stringOrNull(auth.chatgpt_account_id) ??
    stringOrNull(auth.account_id) ??
    stringOrNull(idToken?.account_id) ??
    stringOrNull(idToken?.sub)
  );
}

function decodeJwtPayload(token: string | null) {
  if (!token) {
    return null;
  }
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseRecord(rawJson: string) {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  );
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
