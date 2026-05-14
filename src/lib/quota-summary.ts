export function averageRemainingPercent(values: Array<number | null | undefined>) {
  const remainingValues = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(100, 100 - value)));

  if (remainingValues.length === 0) {
    return null;
  }

  const average = remainingValues.reduce((sum, value) => sum + value, 0) / remainingValues.length;
  return Math.round(average);
}
