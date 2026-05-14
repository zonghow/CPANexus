import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cpaInstances, replenishmentStrategies } from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

const cpaInstanceSchema = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  password: z.string().trim().min(1),
  quotaRefreshPath: z.string().trim().min(1).default("/v0/management/auth-files"),
  enabled: z.boolean().default(true),
});

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    return ok({ instances });
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
    const parsed = cpaInstanceSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const created = db
      .insert(cpaInstances)
      .values({
        ...parsed.data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning()
      .get();

    db.insert(replenishmentStrategies)
      .values({
        cpaInstanceId: created.id,
      })
      .onConflictDoNothing()
      .run();

    return ok({ instance: created }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readJson<{ id: number; enabled: boolean }>(request);
    if (!body.id) {
      return badRequest("id is required");
    }
    db.update(cpaInstances)
      .set({ enabled: Boolean(body.enabled), updatedAt: new Date().toISOString() })
      .where(eq(cpaInstances.id, body.id))
      .run();
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
