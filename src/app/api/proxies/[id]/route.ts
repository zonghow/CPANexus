import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { proxies, proxyCpaInstances } from "@/db/schema";
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

const proxySchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().url(),
  maxAuthFiles: z.number().int().min(1),
  enabled: z.boolean(),
  notes: z.string().optional().nullable(),
  cpaInstanceIds: z.array(z.number().int().positive()).default([]),
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
    const parsed = proxySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const proxy = db
      .update(proxies)
      .set({
        name: parsed.data.name,
        url: parsed.data.url,
        maxAuthFiles: parsed.data.maxAuthFiles,
        enabled: parsed.data.enabled,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(proxies.id, id))
      .returning()
      .get();
    if (!proxy) {
      return notFound("proxy not found");
    }

    db.delete(proxyCpaInstances)
      .where(eq(proxyCpaInstances.proxyId, id))
      .run();
    if (parsed.data.cpaInstanceIds.length > 0) {
      db.insert(proxyCpaInstances)
        .values(parsed.data.cpaInstanceIds.map((cpaInstanceId) => ({ proxyId: id, cpaInstanceId })))
        .onConflictDoNothing()
        .run();
    }

    return ok({ proxy });
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
    db.delete(proxies).where(eq(proxies.id, id)).run();
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
