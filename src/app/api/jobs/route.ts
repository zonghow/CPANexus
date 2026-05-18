import { and, desc, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cpaInstanceSyncRuns, cronJobs, jobRuns } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { nextCronRunAfterLastRun } from "@/lib/cron-next-run";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const now = new Date();
    const url = new URL(request.url);
    const requestedRunsPage = parsePositiveInteger(url.searchParams.get("runsPage")) ?? 1;
    const runsPageSize = Math.min(
      100,
      Math.max(10, parsePositiveInteger(url.searchParams.get("runsPageSize")) ?? 20),
    );
    const jobs = db.select().from(cronJobs).orderBy(cronJobs.name).all();
    const jobKeys = jobs.map((job) => job.key);
    const runsWhere = jobKeys.length > 0 ? inArray(jobRuns.jobKey, jobKeys) : undefined;
    const activeRuns = jobKeys.length > 0
      ? db
        .select()
        .from(jobRuns)
        .where(and(inArray(jobRuns.jobKey, jobKeys), isNull(jobRuns.finishedAt)))
        .all()
      : [];
    const activeRunByJobKey = new Map(activeRuns.map((run) => [run.jobKey, run]));
    const cpaSyncs = db
      .select()
      .from(cpaInstanceSyncRuns)
      .where(isNull(cpaInstanceSyncRuns.finishedAt))
      .all();
    const runsTotal = db
      .select({ count: sql<number>`count(*)` })
      .from(jobRuns)
      .where(runsWhere)
      .get()?.count ?? 0;
    const runsTotalPages = Math.max(1, Math.ceil(runsTotal / runsPageSize));
    const runsPage = Math.min(requestedRunsPage, runsTotalPages);
    const runs = db
      .select()
      .from(jobRuns)
      .where(runsWhere)
      .orderBy(desc(jobRuns.startedAt))
      .limit(runsPageSize)
      .offset((runsPage - 1) * runsPageSize)
      .all();

    return ok({
      jobs: jobs.map((job) => {
        const activeRun = activeRunByJobKey.get(job.key);
        const nextRunAt = job.enabled && !activeRun
          ? nextCronRunAfterLastRun(job.cron, job.lastRunAt, now)
          : null;
        return {
          ...job,
          running: Boolean(activeRun),
          runningStartedAt: activeRun?.startedAt ?? null,
          nextRunAt: nextRunAt?.toISOString() ?? null,
          secondsUntilNextRun: nextRunAt
            ? Math.max(0, Math.ceil((nextRunAt.getTime() - now.getTime()) / 1000))
            : null,
        };
      }),
      runs,
      cpaSyncs: cpaSyncs.map((run) => ({
        cpaInstanceId: run.cpaInstanceId,
        startedAt: run.startedAt,
      })),
      runsPagination: {
        page: runsPage,
        pageSize: runsPageSize,
        total: runsTotal,
        totalPages: runsTotalPages,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
