export function onlyEnabledCpaGroups<T extends { instance: { enabled: boolean } }>(
  groups: T[],
) {
  return groups.filter((group) => group.instance.enabled);
}
