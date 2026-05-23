import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, cpaInstances } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  parseIntegerId,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import { buildAutoAuthFileName } from "@/lib/codex-auth";
import { uploadRemoteAuthFile } from "@/lib/cpa-client";
import { syncCpaInstanceById, type CpaInstanceSyncResult } from "@/lib/jobs";

export const runtime = "nodejs";

type AuthJsonUploadFile = {
  fileName?: unknown;
  payload?: unknown;
};

type AuthJsonUploadBody = {
  files?: unknown;
  source?: unknown;
};

type NormalizedAuthJsonFile = {
  fileName: string;
  payload: Record<string, unknown>;
  email: string | null;
  provider: string | null;
  proxyUrl: string | null;
};

type AuthJsonUploadResult = {
  fileName: string | null;
  email: string | null;
  status: "success" | "error";
  error?: string;
};

type ExpandedAuthJsonFile =
  | {
      kind: "file";
      file: NormalizedAuthJsonFile;
    }
  | {
      kind: "error";
      result: AuthJsonUploadResult;
    };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const cpaInstanceId = parseIntegerId((await routeParams(context)).id);
    if (!cpaInstanceId) {
      return badRequest("CPA instance id is required");
    }

    const instance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, cpaInstanceId))
      .get();
    if (!instance) {
      return notFound("CPA instance not found");
    }

    const body = await readJson<AuthJsonUploadBody>(request);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return badRequest("files is required");
    }

    const source = stringOrNull(body.source);
    const results: AuthJsonUploadResult[] = [];
    for (const file of files) {
      const expandedFiles = expandAuthJsonFile(file, { source });
      for (const expanded of expandedFiles) {
        if (expanded.kind === "error") {
          results.push(expanded.result);
          continue;
        }

        const normalized = expanded.file;
        try {
          await uploadRemoteAuthFile(instance, normalized.fileName, normalized.payload);
          upsertLocalAuthFile(instance.id, normalized);
          results.push({
            fileName: normalized.fileName,
            email: normalized.email,
            status: "success",
          });
        } catch (error) {
          results.push({
            fileName: normalized.fileName,
            email: normalized.email,
            status: "error",
            error: errorMessage(error),
          });
        }
      }
    }

    const uploaded = results.filter((result) => result.status === "success").length;
    const sync = uploaded > 0 ? await syncAffectedCpaInstance(instance.id) : null;
    return ok({
      uploaded,
      failed: results.length - uploaded,
      results,
      sync,
    });
  } catch (error) {
    return serverError(error);
  }
}

function expandAuthJsonFile(
  value: unknown,
  options: { source?: string | null } = {},
): ExpandedAuthJsonFile[] {
  if (!isRecord(value)) {
    return [invalidFileResult(null, "invalid JSON upload item")];
  }

  const file = value as AuthJsonUploadFile;
  const fileName = stringOrNull(file.fileName);
  const payload = file.payload;
  if (!fileName) {
    return [invalidFileResult(fileName, "invalid CPA JSON file")];
  }

  if (options.source === "session-json") {
    const converted = collectSessionLikeObjects(payload)
      .map((item, index) => convertSessionJsonToCpaAuthFile(item.value, item.path, index + 1))
      .filter((item): item is NormalizedAuthJsonFile => item !== null);
    if (converted.length > 0) {
      return converted.map((item) => ({ kind: "file", file: item }));
    }
    return [invalidFileResult(fileName, "未找到包含 accessToken 和账号信息的 Session JSON")];
  }

  if (!isRecord(payload)) {
    return [invalidFileResult(fileName, "invalid CPA JSON file")];
  }

  const sub2apiAccounts = sub2apiAccountsFromPayload(payload);
  if (sub2apiAccounts) {
    const converted = sub2apiAccounts
      .map((account, index) => convertSub2ApiAccount(account, index + 1))
      .filter((item): item is NormalizedAuthJsonFile => item !== null);
    if (converted.length > 0) {
      return converted.map((item) => ({ kind: "file", file: item }));
    }
    return [invalidFileResult(fileName, "no supported OpenAI OAuth accounts found in sub2api JSON")];
  }

  return [
    {
      kind: "file",
      file: {
        fileName,
        payload,
        email: stringOrNull(payload.email),
        provider: stringOrNull(payload.provider) ?? stringOrNull(payload.type),
        proxyUrl: stringOrNull(payload.proxy_url),
      },
    },
  ];
}

function collectSessionLikeObjects(
  value: unknown,
): Array<{ value: Record<string, unknown>; path: string }> {
  const found: Array<{ value: Record<string, unknown>; path: string }> = [];
  const visited = new WeakSet<object>();

  function visit(item: unknown, path: string) {
    if (!isRecord(item) && !Array.isArray(item)) {
      return;
    }

    if (isRecord(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        recordValue(item.token, "accessToken"),
        recordValue(item.token, "access_token"),
        recordValue(item.credentials, "accessToken"),
        recordValue(item.credentials, "access_token"),
      );
      const hasIdentity =
        isRecord(item.user) ||
        Boolean(firstNonEmpty(
          item.email,
          item.name,
          recordValue(item.providerSpecificData, "chatgptAccountId"),
          recordValue(item.providerSpecificData, "chatgpt_account_id"),
          item.id,
        ));
      if (token && hasIdentity) {
        found.push({ value: item, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === "accessToken" || key === "access_token" || key === "sessionToken") {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, "$");
  return found;
}

function convertSessionJsonToCpaAuthFile(
  record: Record<string, unknown>,
  path: string,
  index: number,
): NormalizedAuthJsonFile | null {
  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    recordValue(record.token, "accessToken"),
    recordValue(record.token, "access_token"),
    recordValue(record.credentials, "accessToken"),
    recordValue(record.credentials, "access_token"),
  );
  if (!accessToken) {
    return null;
  }

  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    recordValue(record.token, "sessionToken"),
    recordValue(record.token, "session_token"),
    recordValue(record.credentials, "session_token"),
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    recordValue(record.token, "refreshToken"),
    recordValue(record.token, "refresh_token"),
    recordValue(record.credentials, "refresh_token"),
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    recordValue(record.token, "idToken"),
    recordValue(record.token, "id_token"),
    recordValue(record.credentials, "id_token"),
  );

  const accessPayload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = openAiAuthSection(accessPayload);
  const idAuth = openAiAuthSection(idPayload);
  const profile = openAiProfileSection(accessPayload);
  const user = recordObject(record.user);
  const account = recordObject(record.account);
  const credentials = recordObject(record.credentials);
  const providerSpecificData = recordObject(record.providerSpecificData);
  const expiresAt = firstNonEmpty(
    accessPayload ? timestampFromUnixSeconds(accessPayload.exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
  );
  const email = firstNonEmpty(
    user.email,
    record.email,
    credentials.email,
    providerSpecificData.email,
    profile.email,
    idPayload?.email,
    accessPayload?.email,
  );
  const accountId = firstNonEmpty(
    account.id,
    record.account_id,
    record.chatgptAccountId,
    providerSpecificData.chatgptAccountId,
    providerSpecificData.chatgpt_account_id,
    credentials.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === "codex" ? record.id : undefined,
  );
  const userId = firstNonEmpty(
    user.id,
    record.user_id,
    record.chatgptUserId,
    providerSpecificData.chatgptUserId,
    providerSpecificData.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );
  const planType = firstNonEmpty(
    account.planType,
    account.plan_type,
    record.planType,
    record.plan_type,
    providerSpecificData.chatgptPlanType,
    providerSpecificData.chatgpt_plan_type,
    credentials.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );
  const name = firstNonEmpty(email, stringOrNull(record.name), path, `Session ${index}`) ?? `Session ${index}`;
  const syntheticIdToken = !inputIdToken
    ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
    : null;
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);
  const exportedAt = nowIso();
  const payload = stripUndefined({
    type: "codex",
    account_id: accountId,
    chatgpt_account_id: accountId,
    email,
    name,
    plan_type: planType,
    chatgpt_plan_type: planType,
    id_token: idToken,
    id_token_synthetic: syntheticIdToken ? true : undefined,
    access_token: accessToken,
    refresh_token: refreshToken ?? "",
    session_token: sessionToken,
    last_refresh: exportedAt,
    expired: expiresAt,
    disabled: Boolean(record.disabled) || undefined,
  });

  return {
    fileName: buildAutoAuthFileName(email ?? `session-${index}`),
    payload,
    email: email ?? null,
    provider: "codex",
    proxyUrl: null,
  };
}

function invalidFileResult(fileName: string | null, error: string): ExpandedAuthJsonFile {
  return {
    kind: "error",
    result: {
      fileName,
      email: null,
      status: "error",
      error,
    },
  };
}

function sub2apiAccountsFromPayload(payload: Record<string, unknown>): Record<string, unknown>[] | null {
  if (Array.isArray(payload.accounts)) {
    return payload.accounts.filter(isRecord);
  }
  const data = payload.data;
  if (isRecord(data) && Array.isArray(data.accounts)) {
    return data.accounts.filter(isRecord);
  }
  if (isSub2ApiAccount(payload)) {
    return [payload];
  }
  return null;
}

function convertSub2ApiAccount(
  account: Record<string, unknown>,
  index: number,
): NormalizedAuthJsonFile | null {
  if (!isSub2ApiAccount(account)) {
    return null;
  }

  const platform = stringOrNull(account.platform)?.toLowerCase();
  const type = stringOrNull(account.type)?.toLowerCase();
  if (platform !== "openai" || type !== "oauth") {
    return null;
  }

  const credentials = account.credentials;
  const refreshToken = stringOrNull(credentials.refresh_token);
  const email =
    stringOrNull(credentials.email) ??
    emailFromText(stringOrNull(account.name)) ??
    null;
  if (!refreshToken || !email) {
    return null;
  }

  const payload: Record<string, unknown> = {
    disabled: false,
    email,
    expired: stringOrNull(credentials.expires_at) ?? "1970-01-01T00:00:00Z",
    refresh_token: refreshToken,
    type: "codex",
  };
  setIfString(payload, "access_token", credentials.access_token);
  setIfString(payload, "account_id", credentials.chatgpt_account_id ?? credentials.account_id);
  setIfString(payload, "client_id", credentials.client_id);
  setIfString(payload, "id_token", credentials.id_token);

  return {
    fileName: buildAutoAuthFileName(email || `sub2api-${index}`),
    payload,
    email,
    provider: "codex",
    proxyUrl: null,
  };
}

function upsertLocalAuthFile(
  cpaInstanceId: number,
  file: NormalizedAuthJsonFile,
) {
  const savedAt = nowIso();
  db.insert(authFiles)
    .values({
      cpaInstanceId,
      fileName: file.fileName,
      email: file.email,
      provider: file.provider,
      status: "uploaded",
      statusMessage: "uploaded by CPA Nexus JSON file",
      available: true,
      proxyUrl: file.proxyUrl,
      rawJson: JSON.stringify(file.payload),
      createdAt: savedAt,
      lastSyncedAt: savedAt,
    })
    .onConflictDoUpdate({
      target: [authFiles.cpaInstanceId, authFiles.fileName],
      set: {
        email: file.email,
        provider: file.provider,
        status: "uploaded",
        statusMessage: "uploaded by CPA Nexus JSON file",
        available: true,
        proxyUrl: file.proxyUrl,
        rawJson: JSON.stringify(file.payload),
        lastSyncedAt: savedAt,
      },
    })
    .run();
}

async function syncAffectedCpaInstance(cpaInstanceId: number): Promise<CpaInstanceSyncResult> {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error",
      message: errorMessage(error),
    };
  }
}

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSub2ApiAccount(value: Record<string, unknown>): value is Record<string, unknown> & {
  credentials: Record<string, unknown>;
} {
  return isRecord(value.credentials) &&
    typeof value.platform === "string" &&
    typeof value.type === "string";
}

function setIfString(target: Record<string, unknown>, key: string, value: unknown) {
  const normalized = stringOrNull(value);
  if (normalized) {
    target[key] = normalized;
  }
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const normalized = stringOrNull(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function recordValue(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function recordObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseJwtPayload(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  const segments = token.split(".");
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(segments[1], "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function openAiAuthSection(payload: Record<string, unknown> | undefined) {
  const auth = payload?.["https://api.openai.com/auth"];
  return isRecord(auth) ? auth : {};
}

function openAiProfileSection(payload: Record<string, unknown> | undefined) {
  const profile = payload?.["https://api.openai.com/profile"];
  return isRecord(profile) ? profile : {};
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const normalized = stringOrNull(value);
  if (!normalized) {
    return undefined;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildSyntheticCodexIdToken(
  email: string | undefined,
  accountId: string | undefined,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined,
) {
  if (!accountId) {
    return undefined;
  }

  const now = Math.trunc(Date.now() / 1000);
  const authInfo: Record<string, unknown> = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;

  if (planType) {
    authInfo.chatgpt_plan_type = planType;
  }
  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }

  const payload: Record<string, unknown> = {
    iat: now,
    exp: expires,
    "https://api.openai.com/auth": authInfo,
  };
  if (email) {
    payload.email = email;
  }

  return `${encodeBase64UrlJson({ alg: "none", typ: "JWT", cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
}

function encodeBase64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function epochSecondsFromValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  );
}

function emailFromText(value: string | null) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
