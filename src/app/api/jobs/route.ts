import { desc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { cronJobs, jobRuns } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { nextCronRunAfter } from "@/lib/cron-next-run";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const now = new Date();
    const jobs = db.select().from(cronJobs).orderBy(cronJobs.name).all();
    const jobKeys = jobs.map((job) => job.key);
    const runs = db
      .select()
      .from(jobRuns)
      .where(jobKeys.length > 0 ? inArray(jobRuns.jobKey, jobKeys) : undefined)
      .orderBy(desc(jobRuns.startedAt))
      .limit(50)
      .all();

    return ok({
      jobs: jobs.map((job) => {
        const nextRunAt = job.enabled ? nextCronRunAfter(job.cron, now) : null;
        return {
          ...job,
          nextRunAt: nextRunAt?.toISOString() ?? null,
          secondsUntilNextRun: nextRunAt
            ? Math.max(0, Math.ceil((nextRunAt.getTime() - now.getTime()) / 1000))
            : null,
        };
      }),
      runs,
    });
  } catch (error) {
    return serverError(error);
  }
}
