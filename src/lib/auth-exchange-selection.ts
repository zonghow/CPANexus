export type ExchangeSelectableAuthRow = {
  id: number;
  disabled: boolean;
  quotaStatus: string;
};

export function selectAvailableAuthFileIds<T extends ExchangeSelectableAuthRow>(
  rows: T[],
  count: number,
) {
  return rows
    .filter((row) => !row.disabled && row.quotaStatus === "available")
    .slice(0, Math.max(0, count))
    .map((row) => row.id);
}
