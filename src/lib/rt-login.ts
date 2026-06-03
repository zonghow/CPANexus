import { ProxyAgent } from "undici";

import { buildAutoAuthFileName } from "./codex-auth";

export const openAiCodexClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
export const openAiMobileRtClientId = "app_LlGpXReQgckcGGUo2JrYvtJK";

const openAiTokenUrl = "https://auth.openai.com/oauth/token";
const openAiRefreshScope = "openid profile email";
const openAiUserAgent = "codex-cli/0.91.0";
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const refreshTokenRegex = /\brt_[A-Za-z0-9._-]+/;

export type RtLoginMode = "rt" | "mobile_rt";

export type ParsedRtLoginLine = {
  lineNumber: number;
  sourceLine: string;
  email: string | null;
  refreshToken: string;
};

export type InvalidRtLoginLine = {
  lineNumber: number;
  sourceLine: string;
  reason: "missing refresh token";
};

export type OpenAiTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  email?: unknown;
  plan_type?: unknown;
  client_id?: unknown;
  [key: string]: unknown;
};

export type RtLoginAuthResult = {
  email: string;
  fileName: string;
  planType: string;
  payload: Record<string, unknown>;
  refreshToken: string;
  sourceLine: string;
};

export function clientIdForRtLoginMode(mode: RtLoginMode) {
  return mode === "mobile_rt" ? openAiMobileRtClientId : openAiCodexClientId;
}

export function parseRtLoginLines(text: string) {
  const valid: ParsedRtLoginLine[] = [];
  const invalid: InvalidRtLoginLine[] = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) {
        return;
      }

      const segments = line.split("----").map((segment) => segment.trim());
      const refreshToken =
        segments.find((segment) => refreshTokenRegex.test(segment))?.match(refreshTokenRegex)?.[0] ??
        (segments.length >= 4 ? segments.at(-1) : line.includes("----") ? "" : line) ??
        "";
      if (!refreshToken) {
        invalid.push({
          lineNumber: index + 1,
          sourceLine: line,
          reason: "missing refresh token",
        });
        return;
      }

      valid.push({
        lineNumber: index + 1,
        sourceLine: line,
        email: line.match(emailRegex)?.[0] ?? null,
        refreshToken,
      });
    });

  return { valid, invalid };
}

export async function refreshOpenAiToken(
  refreshToken: string,
  options: {
    clientId?: string;
    fetchImpl?: typeof fetch;
    proxyUrl?: string;
    timeoutMs?: number;
    tokenUrl?: string;
  } = {},
): Promise<OpenAiTokenResponse> {
  const clientId = options.clientId?.trim() || openAiCodexClientId;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    scope: openAiRefreshScope,
  }).toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const init: RequestInit & { dispatcher?: unknown } = {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": openAiUserAgent,
    },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  };

  const proxyUrl = options.proxyUrl?.trim();
  if (proxyUrl) {
    init.dispatcher = new ProxyAgent(proxyUrl);
  }

  const response = await fetchImpl(options.tokenUrl ?? openAiTokenUrl, init);
  const text = await response.text();
  const payload = parseJsonObject(text);

  if (!response.ok) {
    const message = stringOrNull(payload.error) ?? (text.trim() || response.statusText);
    throw new Error(`OpenAI token refresh failed: HTTP ${response.status}: ${truncate(message, 500)}`);
  }

  return payload;
}

export function buildRtLoginAuth(
  row: ParsedRtLoginLine,
  tokenResponse: OpenAiTokenResponse,
  options: {
    now?: Date;
    clientId?: string;
  } = {},
): RtLoginAuthResult {
  const accessToken = stringOrNull(tokenResponse.access_token);
  const idToken = stringOrNull(tokenResponse.id_token);
  if (!accessToken) {
    throw new Error("token response missing access_token");
  }
  if (!idToken) {
    throw new Error("token response missing id_token");
  }

  const now = options.now ?? new Date();
  const idClaims = decodeJwtPayload(idToken);
  const openAiAuth = recordOrEmpty(idClaims["https://api.openai.com/auth"]);
  const email =
    stringOrNull(tokenResponse.email) ??
    stringOrNull(idClaims.email) ??
    stringOrNull(idClaims.email_address) ??
    row.email;
  if (!email) {
    throw new Error("token response missing email");
  }

  const accountId =
    stringOrNull(openAiAuth.chatgpt_account_id) ??
    stringOrNull(openAiAuth.account_id) ??
    stringOrNull(idClaims.chatgpt_account_id) ??
    stringOrNull(idClaims.account_id) ??
    stringOrNull(idClaims.sub) ??
    "";
  const planType = (
    stringOrNull(tokenResponse.plan_type) ??
    stringOrNull(openAiAuth.chatgpt_plan_type) ??
    stringOrNull(openAiAuth.plan_type) ??
    stringOrNull(idClaims.plan_type) ??
    "unknown"
  ).toLowerCase();
  const refreshToken = stringOrNull(tokenResponse.refresh_token) ?? row.refreshToken;
  const expired = formatCpaDate(expiresAt(tokenResponse, idClaims, now));
  const lastRefresh = formatCpaDate(now);
  const payload: Record<string, unknown> = {
    access_token: accessToken,
    account_id: accountId,
    disabled: false,
    email,
    expired,
    id_token: idToken,
    last_refresh: lastRefresh,
    refresh_token: refreshToken,
    type: "codex",
  };
  const clientId = options.clientId?.trim() || stringOrNull(tokenResponse.client_id);
  if (clientId && clientId !== openAiCodexClientId) {
    payload.client_id = clientId;
  }

  return {
    email,
    fileName: buildAutoAuthFileName(email),
    planType,
    payload,
    refreshToken,
    sourceLine: row.sourceLine,
  };
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function expiresAt(tokenResponse: OpenAiTokenResponse, idClaims: Record<string, unknown>, now: Date) {
  const expiresIn = numberOrNull(tokenResponse.expires_in);
  if (expiresIn !== null) {
    return new Date(now.getTime() + expiresIn * 1000);
  }

  const expiresAtSeconds = numberOrNull(tokenResponse.expires_at);
  if (expiresAtSeconds !== null) {
    return new Date(expiresAtSeconds * 1000);
  }

  const jwtExpiresAt = numberOrNull(idClaims.exp);
  if (jwtExpiresAt !== null) {
    return new Date(jwtExpiresAt * 1000);
  }

  throw new Error("token response missing expires_in and id_token exp");
}

function formatCpaDate(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseJsonObject(text: string): OpenAiTokenResponse {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : { raw: text };
  } catch {
    return { raw: text };
  }
}

function recordOrEmpty(value: unknown) {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated]`;
}
