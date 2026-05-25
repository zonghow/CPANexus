import { buildAutoAuthFileName } from "@/lib/codex-auth";
import { badRequest, initRequestDb, ok, serverError, unauthorized } from "@/lib/api";
import { importCandidateAuthFiles } from "@/lib/candidate-auth-import";
import { verifyAdminPassword } from "@/lib/auth";

export const runtime = "nodejs";

type UploadFileItem = {
  fileName: string;
  payload: unknown;
};

export async function POST(request: Request) {
  try {
    const auth = requireBearerPassword(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const files = await parseUploadFiles(request);
    if (files instanceof Response) {
      return files;
    }
    if (files.length === 0) {
      return badRequest("no JSON files or payloads provided");
    }

    return ok(importCandidateAuthFiles(files));
  } catch (error) {
    return serverError(error);
  }
}

function requireBearerPassword(request: Request) {
  const token = bearerToken(request.headers.get("authorization"));
  return token && verifyAdminPassword(token) ? null : unauthorized();
}

function bearerToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

async function parseUploadFiles(request: Request): Promise<UploadFileItem[] | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartUpload(request);
  }
  if (contentType.includes("application/json")) {
    return parseJsonUpload(request);
  }
  return badRequest("content-type must be application/json or multipart/form-data");
}

async function parseMultipartUpload(request: Request): Promise<UploadFileItem[] | Response> {
  const formData = await request.formData();
  const values = [
    ...formData.getAll("files"),
    ...formData.getAll("file"),
  ];
  const files = values.filter(isUploadFile);
  if (files.length === 0) {
    return badRequest("multipart field files is required");
  }

  const items: UploadFileItem[] = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      items.push(...uploadItemsFromPayload(payload, file.name));
    } catch {
      items.push({
        fileName: file.name || "invalid-json.json",
        payload: null,
      });
    }
  }
  return items;
}

async function parseJsonUpload(request: Request): Promise<UploadFileItem[] | Response> {
  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return badRequest("invalid JSON body");
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => uploadItemsFromPayload(item, null, index + 1));
  }
  if (isRecord(payload) && Array.isArray(payload.files)) {
    return payload.files.map((file, index) => uploadItemFromObject(file, index + 1));
  }
  if (isRecord(payload)) {
    return uploadItemsFromPayload(payload, null, 1);
  }
  return badRequest("JSON body must be an array, object, or { files: [...] }");
}

function uploadItemsFromPayload(
  payload: unknown,
  sourceFileName: string | null,
  index = 1,
): UploadFileItem[] {
  const normalizedPayload = coerceJsonPayload(payload);
  if (Array.isArray(normalizedPayload)) {
    return normalizedPayload.map((item, itemIndex) =>
      uploadItemFromPayload(item, indexedFileName(sourceFileName, itemIndex + 1), itemIndex + 1),
    );
  }
  return [uploadItemFromPayload(normalizedPayload, sourceFileName, index)];
}

function uploadItemFromObject(value: unknown, index: number): UploadFileItem {
  if (isRecord(value) && isRecord(value.payload)) {
    return {
      fileName: stringOrNull(value.fileName) ?? fileNameFromPayload(value.payload, index),
      payload: value.payload,
    };
  }
  return uploadItemFromPayload(value, null, index);
}

function uploadItemFromPayload(
  payload: unknown,
  sourceFileName: string | null,
  index: number,
): UploadFileItem {
  const normalizedPayload = coerceJsonPayload(payload);
  return {
    fileName: sourceFileName ?? fileNameFromPayload(normalizedPayload, index),
    payload: normalizedPayload,
  };
}

function coerceJsonPayload(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function fileNameFromPayload(payload: unknown, index: number) {
  const email = emailFromPayload(payload);
  return email ? buildAutoAuthFileName(email) : `openapi-auth-${String(index).padStart(3, "0")}.json`;
}

function indexedFileName(sourceFileName: string | null, index: number) {
  if (!sourceFileName) {
    return null;
  }
  const normalized = sourceFileName.trim();
  if (!normalized) {
    return null;
  }
  const stem = normalized.replace(/\.json$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${stem || "openapi-auth"}-${String(index).padStart(3, "0")}.json`;
}

function emailFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return (
    stringOrNull(payload.email) ??
    stringOrNull(payload.account_email) ??
    stringOrNull(payload.username) ??
    nestedEmail(payload.credentials) ??
    nestedEmail(payload.user) ??
    nestedEmail(payload.account) ??
    stringOrNull(payload.name)?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ??
    null
  );
}

function nestedEmail(value: unknown) {
  return isRecord(value)
    ? (stringOrNull(value.email) ?? stringOrNull(value.account_email))
    : null;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as File).name === "string" &&
    typeof (value as File).text === "function";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
