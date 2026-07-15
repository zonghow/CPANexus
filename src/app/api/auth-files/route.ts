import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { accountTags, authFiles, cpaInstances } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { accountTagLookupKeys } from "@/lib/account-tags";
import {
  accountTypeFromAuthPayload,
  defaultAuthView,
  isAuthView,
  matchesAuthView,
  type AuthView,
} from "@/lib/auth-provider";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const searchParams = new URL(request.url).searchParams;
    const includeRawJson = searchParams.get("raw") === "1";
    const authView = parseAuthView(searchParams.get("authView"));
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const tagByAccountKey = new Map(
      db.select().from(accountTags).all().map((row) => [row.accountKey, row.tag]),
    );
    const groups = instances.map((instance) => ({
      instance,
      authFiles: db
        .select()
        .from(authFiles)
        .where(eq(authFiles.cpaInstanceId, instance.id))
        .orderBy(authFiles.fileName)
        .all()
        .filter((row) => matchesAuthView(row.provider, authView))
        .map((row) => ({
          ...row,
          accountTag: accountTagForAuthFile(row, tagByAccountKey),
          accountType: accountTypeFromAuthPayload(parseJson(row.rawJson)),
          proxyUrl: row.proxyUrl ?? proxyUrlFromRawAuthJson(row.rawJson),
          rawJson: includeRawJson ? row.rawJson : null,
        })),
    }));

    return ok({ groups, authView });
  } catch (error) {
    return serverError(error);
  }
}

function parseAuthView(value: string | null): AuthView {
  return isAuthView(value) ? value : defaultAuthView;
}

function parseJson(rawJson: string | null) {
  if (!rawJson) {
    return null;
  }
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    return null;
  }
}

function accountTagForAuthFile(
  row: typeof authFiles.$inferSelect,
  tagByAccountKey: Map<string, string>,
) {
  for (const key of accountTagLookupKeys(row)) {
    const tag = tagByAccountKey.get(key);
    if (tag) {
      return tag;
    }
  }

  return null;
}

function proxyUrlFromRawAuthJson(rawJson: string | null) {
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const value = parsed.proxy_url ?? parsed.proxyUrl;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
