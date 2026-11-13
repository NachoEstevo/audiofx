import { ChevronDown, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Your chain, collapsed by default: trying sounds needs no params. It opens with a height transition
 * (grid-template-rows 0fr → 1fr) so the rest of the page does not jump.
 */
export function ChainDrawer(props: { count: number; open: boolean; onToggle: () => void; summary: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-card shadow-card" aria-label="Your chain">
      <button onClick={props.onToggle} aria-expanded={props.open} className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left sm:px-7">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
          <Layers className="size-5" strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-display text-lg tracking-[-0.02em]">Your chain</span>
            <span key={props.count} className="pop-in grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 font-mono text-[11px] text-white tabular-nums">
              {props.count}
            </span>
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">{props.summary}</span>
        </span>
        <span className="hidden text-[13px] text-muted-foreground sm:block">{props.open ? "Hide" : "Tweak and export"}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-300 ease-[var(--ease-out)]", props.open && "rotate-180")} strokeWidth={1.5} />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-[var(--ease-out)]", props.open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          <div className={cn("space-y-3 px-5 pb-6 transition-opacity duration-300 sm:px-7", props.open ? "opacity-100" : "opacity-0")}>{props.children}</div>
        </div>
      </div>
    </section>
  );
}
