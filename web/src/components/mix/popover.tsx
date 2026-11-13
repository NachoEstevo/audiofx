import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A panel anchored to an element, fixed to the viewport: it escapes the timeline's scroller, opens upward
 * when there is no room below (the phone's bottom transport) and never widens the page.
 */
export function Popover(props: { anchor: HTMLElement | null; onClose: () => void; label: string; width?: number; className?: string; children: ReactNode }) {
  const { anchor, onClose, width = 300 } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!anchor) return;
    const position = () => {
      const r = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      const h = panel.current?.scrollHeight ?? 0;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = h > below && above > below;
      const maxHeight = Math.max(160, up ? above : below);
      setPlace({
        left: Math.max(8, Math.min(r.left, vw - w - 8)),
        top: up ? Math.max(8, r.top - 6 - Math.min(h, maxHeight)) : r.bottom + 6,
        width: w,
        maxHeight,
      });
    };
    position();
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, width]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.contains(target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor]);

  if (!anchor) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={props.label}
      className={cn("animate-rise fixed z-50 overflow-y-auto overscroll-contain rounded-3xl bg-card p-2 shadow-float", props.className)}
      style={place ? { left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight } : { left: 0, top: 0, width, visibility: "hidden" }}
    >
      {props.children}
    </div>,
    document.body,
  );
}

/** A row of a popover menu: icon, title and a muted line under it. */
export function MenuRow(props: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {props.icon && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted [&_svg]:size-4">{props.icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-sm">{props.title}</span>
        {props.sub && <span className="block text-xs text-pretty text-muted-foreground">{props.sub}</span>}
      </span>
    </button>
  );
}
