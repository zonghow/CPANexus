import { eq } from "drizzle-orm";
import { z } from "zod";

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

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  password: z.string().trim().min(1),
  quotaRefreshPath: z.string().trim().min(1),
  enabled: z.boolean(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const { id: rawId } = await routeParams(context);
    const id = parseIntegerId(rawId);
    if (!id) {
      return badRequest("invalid id");
    }
    const parsed = updateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const updated = db
      .update(cpaInstances)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(cpaInstances.id, id))
      .returning()
      .get();

    return updated ? ok({ instance: updated }) : notFound("CPA instance not found");
  } catch (error) {
    return serverError(error);
  }
}

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
    const { id: rawId } = await routeParams(context);
    const id = parseIntegerId(rawId);
    if (!id) {
      return badRequest("invalid id");
    }

    db.delete(cpaInstances).where(eq(cpaInstances.id, id)).run();
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
