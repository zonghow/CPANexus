"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  applyTheme,
  defaultThemeColor,
  defaultThemeDensity,
  defaultThemeMode,
  isThemeColor,
  isThemeDensity,
  isThemeMode,
  prefersDark,
  themeColorStorageKey,
  themeDensityStorageKey,
  themeModeStorageKey,
  type ThemeColor,
  type ThemeDensity,
  type ThemeMode,
} from "@/lib/theme";

type ThemeState = {
  mode: ThemeMode;
  color: ThemeColor;
  density: ThemeDensity;
};

type ThemeContextValue = {
  mode: ThemeMode;
  color: ThemeColor;
  density: ThemeDensity;
  /** The actually rendered scheme after resolving "system". */
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ThemeColor) => void;
  setDensity: (density: ThemeDensity) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Theme store (external, localStorage-backed). Using an external store with
// useSyncExternalStore keeps reads consistent between server and client and
// avoids both hydration mismatches and setState-in-effect.
// ---------------------------------------------------------------------------

const serverThemeState: ThemeState = {
  mode: defaultThemeMode,
  color: defaultThemeColor,
  density: defaultThemeDensity,
};

let themeState: ThemeState | null = null;
const themeListeners = new Set<() => void>();

function getThemeState(): ThemeState {
  if (typeof window === "undefined") {
    return serverThemeState;
  }
  if (!themeState) {
    const storedMode = window.localStorage.getItem(themeModeStorageKey);
    const storedColor = window.localStorage.getItem(themeColorStorageKey);
    const storedDensity = window.localStorage.getItem(themeDensityStorageKey);
    themeState = {
      mode: isThemeMode(storedMode) ? storedMode : defaultThemeMode,
      color: isThemeColor(storedColor) ? storedColor : defaultThemeColor,
      density: isThemeDensity(storedDensity)
        ? storedDensity
        : defaultThemeDensity,
    };
  }
  return themeState;
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function commitThemeState(next: ThemeState): void {
  themeState = next;
  applyTheme(next.mode, next.color, next.density);
  themeListeners.forEach((listener) => listener());
}

function setStoredMode(mode: ThemeMode): void {
  window.localStorage.setItem(themeModeStorageKey, mode);
  const current = getThemeState();
  commitThemeState({ mode, color: current.color, density: current.density });
}

function setStoredColor(color: ThemeColor): void {
  window.localStorage.setItem(themeColorStorageKey, color);
  const current = getThemeState();
  commitThemeState({ mode: current.mode, color, density: current.density });
}

function setStoredDensity(density: ThemeDensity): void {
  window.localStorage.setItem(themeDensityStorageKey, density);
  const current = getThemeState();
  commitThemeState({ mode: current.mode, color: current.color, density });
}

// System color-scheme store ------------------------------------------------

function subscribeSystemDark(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getSystemDark(): boolean {
  return prefersDark();
}

function getServerSystemDark(): boolean {
  return false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribeTheme,
    getThemeState,
    () => serverThemeState,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getServerSystemDark,
  );

  // Keep the document attributes in sync whenever the resolved theme changes.
  // This effect only touches the DOM (an external system); it never calls
  // setState, so it stays clear of cascading-render lint rules.
  useEffect(() => {
    applyTheme(state.mode, state.color, state.density);
  }, [state.mode, state.color, state.density, systemDark]);

  const resolvedMode: "light" | "dark" =
    (state.mode === "system" ? systemDark : state.mode === "dark")
      ? "dark"
      : "light";

  const setMode = useCallback((next: ThemeMode) => setStoredMode(next), []);
  const setColor = useCallback((next: ThemeColor) => setStoredColor(next), []);
  const setDensity = useCallback(
    (next: ThemeDensity) => setStoredDensity(next),
    [],
  );

  return (
    <ThemeContext.Provider
      value={{
        mode: state.mode,
        color: state.color,
        density: state.density,
        resolvedMode,
        setMode,
        setColor,
        setDensity,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
