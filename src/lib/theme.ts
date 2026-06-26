export type ThemeMode = "light" | "dark" | "system";
export type ThemeColor =
  | "neutral"
  | "blue"
  | "emerald"
  | "violet"
  | "rose"
  | "amber";
export type ThemeDensity = "compact" | "standard" | "loose";

export const themeModes: ThemeMode[] = ["light", "dark", "system"];

export const themeDensities: ThemeDensity[] = [
  "compact",
  "standard",
  "loose",
];

export const themeColors: ThemeColor[] = [
  "neutral",
  "blue",
  "emerald",
  "violet",
  "rose",
  "amber",
];

export const themeModeLabels: Record<ThemeMode, string> = {
  light: "亮色",
  dark: "暗色",
  system: "跟随系统",
};

export const themeDensityLabels: Record<ThemeDensity, string> = {
  compact: "紧凑",
  standard: "标准",
  loose: "宽松",
};

export const themeColorLabels: Record<ThemeColor, string> = {
  neutral: "石墨",
  blue: "海蓝",
  emerald: "翡翠",
  violet: "紫罗兰",
  rose: "玫瑰",
  amber: "琥珀",
};

// A representative swatch color (oklch) used to preview each theme in the UI.
export const themeColorSwatches: Record<ThemeColor, string> = {
  neutral: "oklch(0.45 0 0)",
  blue: "oklch(0.55 0.18 256)",
  emerald: "oklch(0.6 0.13 162)",
  violet: "oklch(0.55 0.22 290)",
  rose: "oklch(0.58 0.2 12)",
  amber: "oklch(0.72 0.16 65)",
};

export const defaultThemeMode: ThemeMode = "system";
export const defaultThemeColor: ThemeColor = "neutral";
export const defaultThemeDensity: ThemeDensity = "standard";

export const themeModeStorageKey = "cpa-nexus-theme-mode";
export const themeColorStorageKey = "cpa-nexus-theme-color";
export const themeDensityStorageKey = "cpa-nexus-theme-density";

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" && themeModes.includes(value as ThemeMode)
  );
}

export function isThemeColor(value: unknown): value is ThemeColor {
  return (
    typeof value === "string" && themeColors.includes(value as ThemeColor)
  );
}

export function isThemeDensity(value: unknown): value is ThemeDensity {
  return (
    typeof value === "string" &&
    themeDensities.includes(value as ThemeDensity)
  );
}

export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "system") {
    return prefersDark();
  }
  return mode === "dark";
}

/**
 * Apply the resolved theme to the document root. Toggling the `.dark` class
 * drives the Tailwind dark variant; the `data-theme` attribute selects the
 * accent color palette and `data-density` selects the spacing scale defined in
 * globals.css.
 */
export function applyTheme(
  mode: ThemeMode,
  color: ThemeColor,
  density: ThemeDensity = defaultThemeDensity,
): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.classList.toggle("dark", resolveIsDark(mode));
  if (color === "neutral") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", color);
  }
  if (density === "standard") {
    root.removeAttribute("data-density");
  } else {
    root.setAttribute("data-density", density);
  }
}

/**
 * Inline script injected before hydration to apply the persisted theme and
 * avoid a flash of the wrong colors. Kept dependency-free and minimal.
 */
export function themeInitScript(): string {
  return `(function(){try{var m=localStorage.getItem(${JSON.stringify(
    themeModeStorageKey,
  )})||${JSON.stringify(defaultThemeMode)};var c=localStorage.getItem(${JSON.stringify(
    themeColorStorageKey,
  )})||${JSON.stringify(
    defaultThemeColor,
  )};var s=localStorage.getItem(${JSON.stringify(
    themeDensityStorageKey,
  )})||${JSON.stringify(
    defaultThemeDensity,
  )};var d=m==="dark"||(m==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);if(c&&c!=="neutral"){r.setAttribute("data-theme",c);}else{r.removeAttribute("data-theme");}if(s&&s!=="standard"){r.setAttribute("data-density",s);}else{r.removeAttribute("data-density");}}catch(e){}})();`;
}
