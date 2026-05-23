type TriggerRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type FloatingMenuOptions = {
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  margin?: number;
};

export function getFloatingMenuPosition(
  triggerRect: TriggerRect,
  options: FloatingMenuOptions,
) {
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;
  const left = clamp(
    triggerRect.right - options.menuWidth,
    margin,
    options.viewportWidth - options.menuWidth - margin,
  );
  const belowTop = triggerRect.bottom + gap;
  const top = belowTop + options.menuHeight + margin <= options.viewportHeight
    ? belowTop
    : clamp(
        triggerRect.top - options.menuHeight - gap,
        margin,
        options.viewportHeight - options.menuHeight - margin,
      );

  return { left, top };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
