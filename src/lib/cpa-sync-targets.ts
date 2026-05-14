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
