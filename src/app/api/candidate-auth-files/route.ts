import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { candidateAuthFiles } from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";
import { importCandidateAuthFiles } from "@/lib/candidate-auth-import";
import { extractQuotaResetTimes } from "@/lib/quota-reset";
import { extractSubscriptionType } from "@/lib/subscription";

export const runtime = "nodejs";

type CandidateAuthFilesUploadBody = {
  files?: unknown;
};

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const rows = db
      .select()
      .from(candidateAuthFiles)
      .orderBy(desc(candidateAuthFiles.updatedAt), desc(candidateAuthFiles.id))
      .all();

    return ok({
      authFiles: rows.map((row) => ({
        ...row,
        subscriptionType:
          extractSubscriptionType(row.quotaRawJson) ??
          extractSubscriptionType(row.rawJson),
        ...extractQuotaResetTimes(row.quotaRawJson, row.lastQuotaRefreshedAt),
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readJson<CandidateAuthFilesUploadBody>(request);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return badRequest("files is required");
    }

    return ok(importCandidateAuthFiles(files));
  } catch (error) {
    return serverError(error);
  }
}
