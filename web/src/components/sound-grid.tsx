import { Crosshair, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CATEGORY_LABELS, type Category } from "../../../src/core/types";
import { GROUP_LABELS, SOUNDS, type Sound } from "../recipes";
import { OrbSwatch, type SwatchMode } from "@/components/ui/orb-swatch";
import { cn } from "@/lib/utils";

type Group = keyof typeof GROUP_LABELS;
const GROUPS = Object.keys(GROUP_LABELS) as Group[];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

/**
 * The grid to try sounds: one tap and it plays over your audio. Keys 1–9 trigger the first nine tiles;
 * holding Shift reveals the shortcuts (a reminder in place, not a separate table).
 */
export function SoundGrid(props: {
  selected: string | null;
  busy: boolean;
  revealKeys: boolean;
  getLevel: () => number;
  onSelect: (sound: Sound) => void;
  onAdd: (sound: Sound) => void;
  onVisible: (sounds: Sound[]) => void;
}) {
  const [group, setGroup] = useState<Group>("moments");
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = SOUNDS.filter(
    (s) =>
      (q ? true : s.group === group) &&
      (group !== "effects" || q || category === "all" || s.category === category) &&
      (!q || `${s.name} ${s.hint} ${s.steps.map((x) => x.effect).join(" ")}`.toLowerCase().includes(q)),
  );
  const onVisible = useRef(props.onVisible);
  onVisible.current = props.onVisible;
  const visibleKey = visible.map((s) => s.id).join(",");
  useEffect(() => {
    onVisible.current(visible);
  }, [visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Sounds">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex rounded-full bg-muted p-1" role="tablist">
          {GROUPS.map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={!q && group === g}
              onClick={() => {
                // The pill slides between tabs with a View Transition (when the browser supports it).
                const apply = () =>
                  flushSync(() => {
                    setGroup(g);
                    setQuery("");
                  });
                const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                if (document.startViewTransition && !reduce) document.startViewTransition(apply);
                else apply();
              }}
              className={cn(
                "relative z-10 h-8 cursor-pointer rounded-full px-3 text-[13px] whitespace-nowrap transition-colors duration-200 sm:px-3.5",
                !q && group === g ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {!q && group === g && <span className="absolute inset-0 -z-10 rounded-full bg-card shadow-ring" style={{ viewTransitionName: "tab-pill" }} />}
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
          <input
            className="h-10 w-full rounded-full bg-muted pr-9 pl-10 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
            placeholder="Search: hit, radio, water…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search sounds"
          />
          {query && (
            <button
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted-strong"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          )}
        </label>
      </div>

      {group === "effects" && !q && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "h-8 shrink-0 cursor-pointer rounded-full px-3 text-[13px] whitespace-nowrap transition-colors",
                category === c ? "bg-foreground text-white" : "bg-card shadow-ring hover:bg-muted",
              )}
            >
              {c === "all" ? "All" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      )}

      <div key={`${group}-${category}-${q ? "q" : ""}`} className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((sound, i) => (
          <Tile
            key={sound.id}
            sound={sound}
            index={i}
            active={props.selected === sound.id}
            busy={props.busy && props.selected === sound.id}
            revealKey={props.revealKeys && i < 9}
            getLevel={props.getLevel}
            onSelect={() => props.onSelect(sound)}
            onAdd={() => props.onAdd(sound)}
          />
        ))}
        {!visible.length && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
      </div>
    </section>
  );
}

function Tile(props: {
  sound: Sound;
  index: number;
  active: boolean;
  busy: boolean;
  revealKey: boolean;
  getLevel: () => number;
  onSelect: () => void;
  onAdd: () => void;
}) {
  const { sound, active } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  // When it is triggered from the keyboard, keep it in view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  const mode: SwatchMode = props.busy ? "busy" : active ? "playing" : hover ? "hover" : "idle";
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={props.onSelect}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
      className={cn(
        "tile group relative flex min-h-[116px] cursor-pointer flex-col rounded-2xl bg-card p-3 text-left outline-none",
        active ? "shadow-[0_0_0_1.5px_var(--color-foreground),0_8px_24px_-12px_rgb(0_0_0/0.25)]" : "shadow-ring hover:shadow-card",
        "focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]",
      )}
      style={{ animationDelay: `${Math.min(props.index, 16) * 18}ms` }}
      title={sound.steps.map((s) => s.effect).join(" + ")}
    >
      <OrbSwatch color={sound.color} seed={sound.id} size={36} mode={mode} getLevel={active ? props.getLevel : undefined} />
      <span className="mt-2.5 line-clamp-1 text-[14px] leading-snug font-medium">{sound.name}</span>
      <span className="mt-0.5 line-clamp-2 pr-7 text-xs leading-snug text-pretty text-muted-foreground lg:pr-0">{sound.hint}</span>
      {sound.timed && (
        <span className="absolute top-3 right-3 text-muted-foreground" title="Lands on the moment marked on the waveform">
          <Crosshair className="size-3.5" strokeWidth={1.5} />
        </span>
      )}
      <kbd
        className={cn(
          "absolute top-2.5 right-8 grid size-5 place-items-center rounded-md bg-foreground font-mono text-[11px] text-white transition-[opacity,scale] duration-150",
          props.revealKey ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0",
        )}
      >
        {props.index + 1}
      </kbd>
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onAdd();
        }}
        className="absolute right-2 bottom-2 grid size-7 cursor-pointer place-items-center rounded-full bg-card text-foreground shadow-ring transition-[opacity,scale] duration-150 hover:bg-muted active:scale-90 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100"
        aria-label={`Add ${sound.name} to your chain`}
        title="Add to your chain"
      >
        <Plus className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
