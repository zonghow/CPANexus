import cron from "node-cron";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { migrate } from "../db/migrate";
import { cronJobs } from "../db/schema";
import { minuteIntervalMsFromCron, nextCronRunAfterLastRun } from "../lib/cron-next-run";
import { isJobAlreadyRunningError, reclaimStaleRuns, runJobByKey } from "../lib/jobs";

type StoppableTask = {
  stop: () => void;
};

type ActiveTask = {
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
  scheduler: "cron" | "anchored-interval";
  task: StoppableTask;
};

const activeTasks = new Map<string, ActiveTask>();

function loadSchedules() {
  migrate();
  const reclaimed = reclaimStaleRuns();
  if (reclaimed > 0) {
    console.log(`[worker] reclaimed ${reclaimed} stale run lock(s)`);
  }
  const jobs = db.select().from(cronJobs).all();
  const seen = new Set<string>();

  for (const job of jobs) {
    seen.add(job.key);
    const existing = activeTasks.get(job.key);
    const scheduler = minuteIntervalMsFromCron(job.cron) ? "anchored-interval" : "cron";
    if (
      existing &&
      existing.cron === job.cron &&
      existing.enabled === job.enabled &&
      existing.scheduler === scheduler &&
      (scheduler === "cron" || existing.lastRunAt === job.lastRunAt)
    ) {
      continue;
    }

    existing?.task.stop();
    activeTasks.delete(job.key);

    if (!job.enabled) {
      continue;
    }

    if (scheduler === "anchored-interval") {
      const task = scheduleAnchoredInterval(job.key, job.cron, job.lastRunAt);
      if (!task) {
        continue;
      }

      activeTasks.set(job.key, {
        cron: job.cron,
        enabled: job.enabled,
        lastRunAt: job.lastRunAt,
        scheduler,
        task,
      });
      continue;
    }

    if (!cron.validate(job.cron)) {
      console.error(`[worker] invalid cron for ${job.key}: ${job.cron}`);
      continue;
    }

    const task = cron.schedule(job.cron, async () => {
      await runScheduledJob(job.key);
    });
    activeTasks.set(job.key, {
      cron: job.cron,
      enabled: job.enabled,
      lastRunAt: job.lastRunAt,
      scheduler,
      task,
    });
    console.log(`[worker] scheduled ${job.key} with ${job.cron}`);
  }

  for (const [key, entry] of activeTasks) {
    if (!seen.has(key)) {
      entry.task.stop();
      activeTasks.delete(key);
    }
  }
}

function scheduleAnchoredInterval(
  jobKey: string,
  expression: string,
  lastRunAt: string | null,
): StoppableTask | null {
  const nextRunAt = nextCronRunAfterLastRun(expression, lastRunAt, new Date());
  if (!nextRunAt) {
    console.error(`[worker] invalid cron for ${jobKey}: ${expression}`);
    return null;
  }

  const delay = Math.max(0, nextRunAt.getTime() - Date.now());
  const timer = setTimeout(async () => {
    const currentJob = db.select().from(cronJobs).where(eq(cronJobs.key, jobKey)).get();
    if (
      !currentJob ||
      !currentJob.enabled ||
      currentJob.cron !== expression ||
      currentJob.lastRunAt !== lastRunAt
    ) {
      loadSchedules();
      return;
    }

    await runScheduledJob(jobKey);
    loadSchedules();
  }, delay);

  console.log(`[worker] scheduled ${jobKey} at ${nextRunAt.toISOString()} with ${expression}`);
  return {
    stop: () => clearTimeout(timer),
  };
}

async function runScheduledJob(jobKey: string) {
  try {
    console.log(`[worker] running ${jobKey}`);
    const result = await runJobByKey(jobKey);
    console.log(`[worker] ${jobKey}: ${result.status} ${result.message}`);
  } catch (error) {
    if (isJobAlreadyRunningError(error)) {
      console.log(`[worker] ${jobKey}: skipped because another run is active`);
      return;
    }
    throw error;
  }
}

function shutdown() {
  for (const entry of activeTasks.values()) {
    entry.task.stop();
  }
  process.exit(0);
}

loadSchedules();
setInterval(loadSchedules, 30_000);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[worker] CPA Nexus worker started");
