import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cronJobs } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";

export const runtime = "nodejs";

const jobSchema = z.object({
  cron: z.string().trim().min(1),
  enabled: z.boolean(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const { key } = await routeParams(context);
    const parsed = jobSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const job = db
      .update(cronJobs)
      .set({
        cron: parsed.data.cron,
        enabled: parsed.data.enabled,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(cronJobs.key, decodeURIComponent(key)))
      .returning()
      .get();

    return job ? ok({ job }) : notFound("job not found");
  } catch (error) {
    return serverError(error);
  }
}
