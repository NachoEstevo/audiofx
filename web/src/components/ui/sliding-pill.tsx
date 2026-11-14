import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How long the pill slides and the labels cross-fade their colour; both use the same timing so they move as one. */
export const PILL_TRANSITION = "transition-colors duration-[380ms] ease-[var(--ease-out)]";

/**
 * One indicator that slides and resizes to the active item of a pill group (the header's screens, the
 * sound tabs). Items register with `itemRef(key)`; with no active key the pill fades out in place.
 * The container must be `relative`.
 */
export function useSlidingPill(active: string | null) {
  const items = useRef(new Map<string, HTMLElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // Measured, not animated, on the first paint: the pill should not fly in from the corner.
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const place = () => {
      const el = active === null ? undefined : items.current.get(active);
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    place();
    const frame = requestAnimationFrame(() => setMoving(true));
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [active]);

  const itemRef = (key: string) => (el: HTMLElement | null) => {
    if (el) items.current.set(key, el);
    else items.current.delete(key);
  };
  const indicator = pill && (
    <span
      aria-hidden
      className={cn(
        "absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-ring motion-reduce:transition-none",
        moving && "transition-[translate,width,opacity] duration-[380ms] ease-[var(--ease-out)]",
        active === null && "opacity-0",
      )}
      style={{ translate: `${pill.left}px 0`, width: pill.width }}
    />
  );
  return { itemRef, indicator };
}
