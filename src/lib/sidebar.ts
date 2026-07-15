export type SidebarMode = "expanded" | "collapsed" | "auto";

export const sidebarModes: SidebarMode[] = ["expanded", "collapsed", "auto"];

export const sidebarModeLabels: Record<SidebarMode, string> = {
  expanded: "固定展开",
  collapsed: "固定收起",
  auto: "自动隐藏",
};

export const sidebarModeDescriptions: Record<SidebarMode, string> = {
  expanded: "始终保持展开",
  collapsed: "仅显示图标",
  auto: "悬停左侧边缘时弹出",
};

// Width bounds (px) for the expanded sidebar. Standard baseline is 160px.
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 160;
// Fixed width used when the sidebar is collapsed to icons only.
export const SIDEBAR_COLLAPSED_WIDTH = 56;

export const defaultSidebarMode: SidebarMode = "expanded";

export const sidebarModeStorageKey = "cpa-nexus-sidebar-mode";
export const sidebarWidthStorageKey = "cpa-nexus-sidebar-width";

export function isSidebarMode(value: unknown): value is SidebarMode {
  return (
    typeof value === "string" && sidebarModes.includes(value as SidebarMode)
  );
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}
