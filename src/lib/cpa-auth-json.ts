import { buildAutoAuthFileName } from "./codex-auth";

export type CpaAuthJsonUploadFile = {
  fileName?: unknown;
  payload?: unknown;
};

export type NormalizedCpaAuthFile = {
  fileName: string;
  payload: Record<string, unknown>;
  email: string | null;
  provider: string | null;
  proxyUrl: string | null;
};

export type CpaAuthJsonUploadResult = {
  fileName: string | null;
  email: string | null;
  status: "success" | "error";
  error?: string;
};

export type ExpandedCpaAuthJsonFile =
  | {
      kind: "file";
      file: NormalizedCpaAuthFile;
    }
  | {
      kind: "error";
      result: CpaAuthJsonUploadResult;
    };

export function expandCpaAuthJsonFile(value: unknown): ExpandedCpaAuthJsonFile[] {
  if (!isRecord(value)) {
    return [invalidFileResult(null, "invalid JSON upload item")];
  }

  const file = value as CpaAuthJsonUploadFile;
  const fileName = stringOrNull(file.fileName);
  const payload = file.payload;
  if (!fileName || !isRecord(payload)) {
    return [invalidFileResult(fileName, "invalid CPA JSON file")];
  }

  const sub2apiAccounts = sub2apiAccountsFromPayload(payload);
  if (sub2apiAccounts) {
    const converted = sub2apiAccounts
      .map((account, index) => convertSub2ApiAccount(account, index + 1))
      .filter((item): item is NormalizedCpaAuthFile => item !== null);
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

function invalidFileResult(fileName: string | null, error: string): ExpandedCpaAuthJsonFile {
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
): NormalizedCpaAuthFile | null {
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

function emailFromText(value: string | null) {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
