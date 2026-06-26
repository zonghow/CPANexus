"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  clampSidebarWidth,
  defaultSidebarMode,
  isSidebarMode,
  SIDEBAR_DEFAULT_WIDTH,
  sidebarModeStorageKey,
  sidebarWidthStorageKey,
  type SidebarMode,
} from "@/lib/sidebar";

type SidebarPersisted = { mode: SidebarMode; width: number };

const serverState: SidebarPersisted = {
  mode: defaultSidebarMode,
  width: SIDEBAR_DEFAULT_WIDTH,
};

let sidebarState: SidebarPersisted | null = null;
const listeners = new Set<() => void>();

function getSidebarState(): SidebarPersisted {
  if (typeof window === "undefined") {
    return serverState;
  }
  if (!sidebarState) {
    const storedMode = window.localStorage.getItem(sidebarModeStorageKey);
    const storedWidth = Number(
      window.localStorage.getItem(sidebarWidthStorageKey),
    );
    sidebarState = {
      mode: isSidebarMode(storedMode) ? storedMode : defaultSidebarMode,
      width:
        Number.isFinite(storedWidth) && storedWidth > 0
          ? clampSidebarWidth(storedWidth)
          : SIDEBAR_DEFAULT_WIDTH,
    };
  }
  return sidebarState;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(next: SidebarPersisted): void {
  sidebarState = next;
  listeners.forEach((listener) => listener());
}

function setStoredMode(mode: SidebarMode): void {
  window.localStorage.setItem(sidebarModeStorageKey, mode);
  notify({ mode, width: getSidebarState().width });
}

// Live width update during a drag (re-renders without persisting on every move).
function setLiveWidth(width: number): void {
  notify({ mode: getSidebarState().mode, width: clampSidebarWidth(width) });
}

function persistWidth(width: number): void {
  const clamped = clampSidebarWidth(width);
  window.localStorage.setItem(sidebarWidthStorageKey, String(clamped));
  notify({ mode: getSidebarState().mode, width: clamped });
}

export type UseSidebarResult = {
  mode: SidebarMode;
  width: number;
  setMode: (mode: SidebarMode) => void;
  autoOpen: boolean;
  setAutoOpen: (open: boolean) => void;
  resizing: boolean;
  startResize: (event: React.MouseEvent) => void;
};

export function useSidebar(): UseSidebarResult {
  const state = useSyncExternalStore(
    subscribe,
    getSidebarState,
    () => serverState,
  );
  const [autoOpen, setAutoOpen] = useState(false);
  const [resizing, setResizing] = useState(false);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing(true);
    const startX = event.clientX;
    const startWidth = getSidebarState().width;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function handleMove(moveEvent: MouseEvent) {
      setLiveWidth(startWidth + (moveEvent.clientX - startX));
    }
    function handleUp() {
      persistWidth(getSidebarState().width);
      setResizing(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    }

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  return {
    mode: state.mode,
    width: state.width,
    setMode: setStoredMode,
    autoOpen,
    setAutoOpen,
    resizing,
    startResize,
  };
}
