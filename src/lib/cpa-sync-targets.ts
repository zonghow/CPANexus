export type CpaSyncTarget = {
  id: number;
  enabled: boolean;
};

export function cpaTableUpdatingIdsForJob(
  jobKey: string,
  instances: CpaSyncTarget[],
) {
  if (jobKey !== "sync-cpa-instances") {
    return [];
  }

  return instances
    .filter((instance) => instance.enabled)
    .map((instance) => instance.id);
}

export function jobFinishedAtOrAfter(
  job: { lastRunAt: string | null },
  scheduledRunAt: string,
) {
  if (!job.lastRunAt) {
    return false;
  }

  const lastRunAt = new Date(job.lastRunAt).getTime();
  const scheduledAt = new Date(scheduledRunAt).getTime();
  return Number.isFinite(lastRunAt) && Number.isFinite(scheduledAt) && lastRunAt >= scheduledAt;
}
