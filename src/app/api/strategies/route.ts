import { z } from "zod";

import { db } from "@/db/client";
import {
  cpaInstances,
  replenishmentStrategies,
} from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

const strategySchema = z.object({
  cpaInstanceId: z.number().int().positive(),
  enabled: z.boolean(),
  maintain5hUsagePercent: z.number().min(0).max(100),
  maintainWeekUsagePercent: z.number().min(0).max(100),
  minAvailableAccounts: z.number().int().min(0),
  maxBatchSize: z.number().int().min(1).max(50),
});

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    ensureStrategies();

    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const strategies = db.select().from(replenishmentStrategies).all();

    return ok({
      strategies: instances.map((instance) => ({
        instance,
        strategy: strategies.find((item) => item.cpaInstanceId === instance.id) ?? null,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const parsed = strategySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const updatedAt = new Date().toISOString();
    const strategy = db
      .insert(replenishmentStrategies)
      .values({ ...parsed.data, updatedAt })
      .onConflictDoUpdate({
        target: replenishmentStrategies.cpaInstanceId,
        set: { ...parsed.data, updatedAt },
      })
      .returning()
      .get();

    return ok({ strategy });
  } catch (error) {
    return serverError(error);
  }
}

function ensureStrategies() {
  const instances = db.select().from(cpaInstances).all();
  for (const instance of instances) {
    db.insert(replenishmentStrategies)
      .values({ cpaInstanceId: instance.id })
      .onConflictDoNothing()
      .run();
  }
}
