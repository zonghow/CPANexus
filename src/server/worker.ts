import cron, { type ScheduledTask } from "node-cron";

import { db } from "../db/client";
import { migrate } from "../db/migrate";
import { cronJobs } from "../db/schema";
import { runJobByKey } from "../lib/jobs";

type ActiveTask = {
  cron: string;
  enabled: boolean;
  task: ScheduledTask;
};

const activeTasks = new Map<string, ActiveTask>();

function loadSchedules() {
  migrate();
  const jobs = db.select().from(cronJobs).all();
  const seen = new Set<string>();

  for (const job of jobs) {
    seen.add(job.key);
    const existing = activeTasks.get(job.key);
    if (existing && existing.cron === job.cron && existing.enabled === job.enabled) {
      continue;
    }

    existing?.task.stop();
    activeTasks.delete(job.key);

    if (!job.enabled) {
      continue;
    }

    if (!cron.validate(job.cron)) {
      console.error(`[worker] invalid cron for ${job.key}: ${job.cron}`);
      continue;
    }

    const task = cron.schedule(job.cron, async () => {
      console.log(`[worker] running ${job.key}`);
      const result = await runJobByKey(job.key);
      console.log(`[worker] ${job.key}: ${result.status} ${result.message}`);
    });
    activeTasks.set(job.key, {
      cron: job.cron,
      enabled: job.enabled,
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
