import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { exceptionAuthFiles } from "@/db/schema";
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
  loadExceptionAuthFile,
  loadTargetCpaInstance,
  moveExceptionAuthFileToCpa,
} from "@/lib/exception-auth-files";
import { syncCpaInstanceById, type CpaInstanceSyncResult } from "@/lib/jobs";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    const result = db.delete(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, id)).run();
    if (result.changes === 0) {
      return notFound("exception auth file not found");
    }

    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    const body = await readJson<{ targetCpaInstanceId?: number }>(request);
    if (!body.targetCpaInstanceId) {
      return badRequest("target CPA instance is required");
    }

    const row = loadExceptionAuthFile(id);
    if (!row) {
      return notFound("exception auth file not found");
    }

    const targetInstance = loadTargetCpaInstance(body.targetCpaInstanceId);
    if (!targetInstance) {
      return notFound("target CPA instance not found");
    }
    if (!targetInstance.enabled) {
      return badRequest("target CPA instance is disabled");
    }

    try {
      await moveExceptionAuthFileToCpa(row, targetInstance);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }

    return okWithOptionalSync({
      status: "ok",
      sync: await syncAffectedCpaInstance(targetInstance.id),
    });
  } catch (error) {
    return serverError(error);
  }
}

async function syncAffectedCpaInstance(cpaInstanceId: number) {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function okWithOptionalSync(result: { status: "ok"; sync: CpaInstanceSyncResult }) {
  return ok(
    result.sync.status === "error"
      ? { status: "ok", sync: result.sync }
      : { status: "ok" },
  );
}
