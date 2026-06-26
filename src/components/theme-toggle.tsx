"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import {
  themeColorLabels,
  themeColorSwatches,
  themeColors,
  themeDensityLabels,
  themeDensities,
  themeModeLabels,
  themeModes,
  type ThemeMode,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const modeIcons: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle() {
  const { mode, color, density, resolvedMode, setMode, setColor, setDensity } =
    useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const ActiveModeIcon = resolvedMode === "dark" ? Moon : Sun;

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        title="主题设置"
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveModeIcon className="h-4 w-4" />
        主题
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          <div className="px-1.5 pb-1 text-xs font-medium text-muted-foreground">
            外观模式
          </div>
          <div className="grid grid-cols-3 gap-1">
            {themeModes.map((value) => {
              const Icon = modeIcons[value];
              const selected = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => setMode(value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-1.5 py-2 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {themeModeLabels[value]}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-1 px-1.5 pb-1 text-xs font-medium text-muted-foreground">
            <Palette className="h-3.5 w-3.5" />
            主题色
          </div>
          <div className="grid grid-cols-1 gap-0.5">
            {themeColors.map((value) => {
              const selected = color === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => setColor(value)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors",
                    selected
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-black/10 dark:border-white/15"
                    style={{ backgroundColor: themeColorSwatches[value] }}
                  />
                  <span className="flex-1 text-left">
                    {themeColorLabels[value]}
                  </span>
                  {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-3 px-1.5 pb-1 text-xs font-medium text-muted-foreground">
            界面密度
          </div>
          <div className="grid grid-cols-3 gap-1">
            {themeDensities.map((value) => {
              const selected = density === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => setDensity(value)}
                  className={cn(
                    "rounded-md border px-1.5 py-1.5 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {themeDensityLabels[value]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
