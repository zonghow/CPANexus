import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { cpaInstances } from "@/db/schema";
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
import {
  startCodexOAuth,
  submitCodexOAuthCallback,
} from "@/lib/cpa-client";
import {
  syncCpaInstanceById,
  type CpaInstanceSyncResult,
} from "@/lib/jobs";

export const runtime = "nodejs";

type OAuthAction = "start" | "callback";

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

    const body = await readJson<{ action?: OAuthAction; redirectUrl?: string }>(request);
    if (body.action !== "start" && body.action !== "callback") {
      return badRequest("action must be start or callback");
    }

    const instance = db
      .select()
      .from(cpaInstances)
      .where(eq(cpaInstances.id, cpaInstanceId))
      .get();
    if (!instance) {
      return notFound("CPA instance not found");
    }

    if (body.action === "start") {
      return ok(await startCodexOAuth(instance));
    }

    const redirectUrl = body.redirectUrl?.trim();
    if (!redirectUrl) {
      return badRequest("redirectUrl is required");
    }

    await submitCodexOAuthCallback(instance, redirectUrl);
    const sync = await syncAffectedCpaInstance(cpaInstanceId);

    return ok(sync.status === "error" ? { status: "ok", sync } : { status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}

async function syncAffectedCpaInstance(cpaInstanceId: number): Promise<CpaInstanceSyncResult> {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
