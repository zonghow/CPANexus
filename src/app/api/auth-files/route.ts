import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, cpaInstances } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const includeRawJson = new URL(request.url).searchParams.get("raw") === "1";
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const groups = instances.map((instance) => ({
      instance,
      authFiles: db
        .select()
        .from(authFiles)
        .where(eq(authFiles.cpaInstanceId, instance.id))
        .orderBy(authFiles.fileName)
        .all()
        .map((row) => ({
          ...row,
          proxyUrl: row.proxyUrl ?? proxyUrlFromRawAuthJson(row.rawJson),
          rawJson: includeRawJson ? row.rawJson : null,
        })),
    }));

    return ok({ groups });
  } catch (error) {
    return serverError(error);
  }
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
