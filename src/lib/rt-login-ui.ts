export type RtLoginProxyMode = "none" | "pool";

export function defaultRtLoginProxyMode(enabledProxyCount: number): RtLoginProxyMode {
  return enabledProxyCount > 0 ? "pool" : "none";
}
