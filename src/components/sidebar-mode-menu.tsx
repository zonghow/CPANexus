"use client";

import {
  Check,
  PanelLeftClose,
  PanelLeftDashed,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  sidebarModeDescriptions,
  sidebarModeLabels,
  sidebarModes,
  type SidebarMode,
} from "@/lib/sidebar";
import { cn } from "@/lib/utils";

const modeIcons: Record<SidebarMode, typeof PanelLeftOpen> = {
  expanded: PanelLeftOpen,
  collapsed: PanelLeftClose,
  auto: PanelLeftDashed,
};

export function SidebarModeMenu({
  mode,
  onSelect,
}: {
  mode: SidebarMode;
  onSelect: (mode: SidebarMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
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

  const ActiveIcon = modeIcons[mode];

  function toggle() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen((value) => !value);
  }

  return (
    <span ref={wrapperRef} className="inline-flex">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        title="侧边栏显示方式"
        onClick={toggle}
      >
        <ActiveIcon className="h-4 w-4" />
      </Button>

      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              role="menu"
              className="fixed z-50 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: position.top, left: position.left }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                侧边栏显示方式
              </div>
              {sidebarModes.map((value) => {
                const Icon = modeIcons[value];
                const selected = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      onSelect(value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      selected
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">
                      <span className="block text-sm">
                        {sidebarModeLabels[value]}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {sidebarModeDescriptions[value]}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
