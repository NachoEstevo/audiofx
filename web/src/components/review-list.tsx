import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Scissors, Search, TriangleAlert, Wrench, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { CATEGORY_LABELS, type Category, type EffectDefinition } from "../../../src/core/types";
import { FILTER_LABELS, REVIEWABLE, UNLISTED, type Entries, type Filter, type Verdict } from "../review-store";
import { Button } from "@/components/ui/button";
import { CATEGORY_ICONS } from "@/icons";
import { cn } from "@/lib/utils";

/** Each verdict has a word, a key and a shape: the state never rests on colour. */
export const VERDICT_UI: Record<Verdict, { label: string; key: string; icon: LucideIcon }> = {
  keep: { label: "Keep", key: "K", icon: Check },
  tweak: { label: "Tweak", key: "T", icon: Wrench },
  cut: { label: "Cut", key: "X", icon: Scissors },
};

const FILTERS = Object.keys(FILTER_LABELS) as Filter[];

type Groups = { category: Category; effects: EffectDefinition[] }[];

interface ListProps {
  groups: Groups;
  entries: Entries;
  current: string;
  reviewed: number;
  counts: Record<Filter, number>;
  filter: Filter;
  onFilter: (f: Filter) => void;
  problem: string | null;
  onPick: (id: string) => void;
  className?: string;
}

function Progress({ reviewed }: { reviewed: number }) {
  const total = REVIEWABLE.length;
  return (
    <div>
      <p className="text-[13px]">
        <span className="font-medium tabular-nums">{reviewed}</span> of <span className="tabular-nums">{total}</span> reviewed
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted-strong" aria-hidden>
        <div className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${(reviewed / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Filters({ filter, counts, onFilter, className }: { filter: Filter; counts: Record<Filter, number>; onFilter: (f: Filter) => void; className?: string }) {
  return (
    <div role="group" aria-label="Show" className={cn("flex gap-1.5", className)}>
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={filter === f}
          onClick={() => onFilter(f)}
          className={cn(
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap outline-none transition-colors focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]",
            filter === f ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong",
          )}
        >
          {FILTER_LABELS[f]}
          <span className={cn("font-mono text-[11px] tabular-nums", filter === f ? "text-white/70" : "text-muted-foreground")}>{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-1.5 rounded-2xl bg-muted px-3 py-2 text-xs text-pretty">
      <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
      {text}
    </p>
  );
}

export function VerdictMark({ verdict, className }: { verdict?: Verdict; className?: string }) {
  const Icon = verdict ? VERDICT_UI[verdict].icon : CircleDashed;
  return <Icon className={cn("size-3.5 shrink-0", className)} strokeWidth={verdict ? 2 : 1.5} aria-hidden />;
}

/** Desktop: progress, filters, search and every effect by category with its verdict. */
export function ReviewList(props: ListProps & { query: string; onQuery: (q: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLButtonElement>(null);

  // Keep the current effect in view inside the list (not the page) when the keys move it.
  useEffect(() => {
    const row = currentRow.current;
    const box = scroller.current;
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const header = 32; // the sticky category heading
    if (r.top < b.top + header) box.scrollTop -= b.top + header - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [props.current, props.groups]);

  return (
    <aside aria-label="Effects to review" className={cn("flex flex-col rounded-[28px] bg-card shadow-card lg:max-h-[calc(100dvh-8rem)]", props.className)}>
      <div className="space-y-3 p-4 pb-2">
        <Progress reviewed={props.reviewed} />
        <Filters filter={props.filter} counts={props.counts} onFilter={props.onFilter} className="flex-wrap" />
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
          <input
            className="h-9 w-full rounded-full bg-muted pr-8 pl-9 text-[13px] outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
            placeholder="Search effects"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            aria-label="Search effects"
          />
          {props.query && (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted-strong"
              onClick={() => props.onQuery("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          )}
        </label>
        {props.problem && <Problem text={props.problem} />}
      </div>

      {/* relative: the rows' sr-only labels are absolutely positioned and must be clipped here, not stretch the page. */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {props.groups.map(({ category, effects }) => {
          const Icon = CATEGORY_ICONS[category];
          const all = REVIEWABLE.filter((e) => e.category === category);
          const done = all.filter((e) => props.entries[e.id]).length;
          return (
            <section key={category} aria-label={CATEGORY_LABELS[category]}>
              <h3 className="sticky top-0 z-10 flex items-center gap-1.5 bg-card px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
                {CATEGORY_LABELS[category]}
                <span className="ml-auto font-mono font-normal tabular-nums">
                  {done}/{all.length}
                </span>
              </h3>
              <ul>
                {effects.map((effect) => {
                  const on = effect.id === props.current;
                  const verdict = props.entries[effect.id]?.verdict;
                  return (
                    <li key={effect.id}>
                      <button
                        ref={on ? currentRow : undefined}
                        type="button"
                        onClick={() => props.onPick(effect.id)}
                        aria-current={on ? "true" : undefined}
                        className={cn(
                          "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-full px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]",
                          on ? "bg-foreground text-white" : "hover:bg-muted",
                        )}
                      >
                        <VerdictMark verdict={verdict} className={on ? "text-white" : verdict ? "text-foreground" : "text-muted-foreground"} />
                        <span className="min-w-0 flex-1 truncate">{effect.name}</span>
                        <span className={cn("text-[11px]", on ? "text-white/70" : "text-muted-foreground")}>
                          {verdict ? VERDICT_UI[verdict].label.toLowerCase() : <span className="sr-only">not reviewed</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!props.groups.length && <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing matches.</p>}
      </div>
      <p className="border-t border-border px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">{UNLISTED.join(", ")} is not listed: it needs a sample file to play.</p>
    </aside>
  );
}

/** Phone: the list collapses to a picker with previous and next. */
export function ReviewPicker(props: ListProps & { onMove: (delta: number) => void }) {
  const listed = props.groups.some((g) => g.effects.some((e) => e.id === props.current));
  const current = REVIEWABLE.find((e) => e.id === props.current);
  const label = (e: EffectDefinition) => {
    const verdict = props.entries[e.id]?.verdict;
    return verdict ? `${e.name} · ${verdict}` : e.name;
  };
  return (
    <div className={cn("space-y-3", props.className)}>
      <Progress reviewed={props.reviewed} />
      <Filters filter={props.filter} counts={props.counts} onFilter={props.onFilter} className="no-scrollbar -mx-4 overflow-x-auto px-4" />
      <div className="flex items-center gap-2">
        <Button size="icon" onClick={() => props.onMove(-1)} aria-label="Previous effect">
          <ChevronLeft strokeWidth={1.5} />
        </Button>
        <span className="relative inline-flex h-9 min-w-0 flex-1 items-center rounded-full bg-muted text-[13px] transition-colors hover:bg-muted-strong">
          <select
            aria-label="Effect to review"
            value={props.current}
            onChange={(e) => props.onPick(e.target.value)}
            className="h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent pr-8 pl-3.5 outline-none focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]"
          >
            {!listed && current && <option value={current.id}>{label(current)}</option>}
            {props.groups.map(({ category, effects }) => (
              <optgroup key={category} label={CATEGORY_LABELS[category]}>
                {effects.map((e) => (
                  <option key={e.id} value={e.id}>
                    {label(e)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 size-3.5" strokeWidth={1.5} />
        </span>
        <Button size="icon" onClick={() => props.onMove(1)} aria-label="Next effect">
          <ChevronRight strokeWidth={1.5} />
        </Button>
      </div>
      {props.problem && <Problem text={props.problem} />}
      <p className="text-[11px] text-muted-foreground">{UNLISTED.join(", ")} is not listed: it needs a sample file to play.</p>
    </div>
  );
}
