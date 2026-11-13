import { AudioLines, ChevronDown, CloudRain, Drum, FolderOpen, Mic, Music, RefreshCw, Search, Sparkles, Upload, Wand2, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GeneratePanel, type GenerateRequest } from "@/components/generate-panel";
import { cn } from "@/lib/utils";

export interface LibraryItem {
  id: string;
  name: string;
  folder: string;
  kind: "voice" | "music" | "sfx" | "mix";
  sizeMb: number;
  generated: boolean;
  sample: boolean;
}

export type SourceRef = { type: "library"; id: string } | { type: "demo"; kind: string } | { type: "upload" } | { type: "generate"; request: GenerateRequest };

export const DEMOS: { kind: string; label: string; icon: LucideIcon }[] = [
  { kind: "voice", label: "Voice (TTS)", icon: Mic },
  { kind: "music", label: "Synthesized music", icon: Music },
  { kind: "ambience", label: "Rain and city", icon: CloudRain },
  { kind: "impact", label: "Explosion", icon: Zap },
  { kind: "beat", label: "Beat", icon: Drum },
];

const KINDS: { kind: LibraryItem["kind"]; label: string; icon: LucideIcon }[] = [
  { kind: "voice", label: "Voices", icon: Mic },
  { kind: "music", label: "Music", icon: Music },
  { kind: "sfx", label: "Effects", icon: Sparkles },
  { kind: "mix", label: "Mixes", icon: AudioLines },
];
const KIND_ICON = Object.fromEntries(KINDS.map((k) => [k.kind, k.icon])) as Record<LibraryItem["kind"], LucideIcon>;

/** Source picker: your audio first (generations, voices, music, effects), the generated demos last. */
export function SourcePicker(props: {
  current: { name: string; duration: number } | null;
  loading: string | null;
  library: { items: LibraryItem[]; folders: string[] } | null;
  onPick: (ref: SourceRef) => void;
  onUpload: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"library" | "generate">("library");
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (ref: SourceRef) => {
    setOpen(false);
    props.onPick(ref);
  };
  const q = query.trim().toLowerCase();
  const items = (props.library?.items ?? []).filter((i) => !q || `${i.name} ${i.folder}`.toLowerCase().includes(q));
  const generated = items.filter((i) => i.generated);

  return (
    // min-w-0: as a flex item it would otherwise grow to the full file name and overflow the card.
    <div ref={root} className="relative min-w-0 max-w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={props.current?.name}
        className="inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-full bg-muted pr-3 pl-1.5 text-[13px] transition-colors hover:bg-muted-strong"
      >
        <span className="grid size-6 place-items-center rounded-full bg-card shadow-ring">
          {props.loading ? <RefreshCw className="size-3.5 animate-spin" strokeWidth={1.5} /> : <AudioLines className="size-3.5" strokeWidth={1.5} />}
        </span>
        <span className="truncate">{props.loading ?? props.current?.name ?? "Pick an audio"}</span>
        {props.current && !props.loading && <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground">{props.current.duration.toFixed(1)} s</span>}
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} strokeWidth={1.5} />
      </button>

      <div
        className={cn(
          "absolute top-11 left-0 z-40 w-[min(92vw,26rem)] origin-top-left rounded-3xl bg-card p-2 shadow-float transition-[opacity,scale,translate] duration-200 ease-[var(--ease-out)]",
          open ? "visible scale-100 opacity-100" : "invisible -translate-y-1 scale-[0.97] opacity-0",
        )}
        role="dialog"
        aria-label="Pick an audio"
      >
        <div className="flex rounded-full bg-muted p-1" role="tablist">
          {(
            [
              ["library", "Your audio", AudioLines],
              ["generate", "Generate", Wand2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] transition-colors",
                tab === id ? "bg-card text-foreground shadow-ring" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.5} /> {label}
            </button>
          ))}
        </div>

        {tab === "generate" ? (
          <GeneratePanel open={open} busy={!!props.loading} onGenerate={(request) => pick({ type: "generate", request })} />
        ) : (
          <>
            <label className="relative block p-1 pt-2">
              <Search className="pointer-events-none absolute top-[calc(50%+2px)] left-4 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
              <input
                className="h-10 w-full rounded-full bg-muted pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
                placeholder="Search your audio"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="max-h-[min(42dvh,26rem)] overflow-y-auto overscroll-contain px-1 pb-1">
              {generated.length > 0 && (
                <section className="pt-2">
                  <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                    Generated <span className="font-mono">{generated.length}</span>
                  </h3>
                  {generated.map((item) => (
                    <Row key={item.id} icon={KIND_ICON[item.kind]} accent title={item.name} sub={`ElevenLabs · ${item.kind} · ${item.sizeMb} MB`} onClick={() => pick({ type: "library", id: item.id })} />
                  ))}
                </section>
              )}
              {KINDS.map(({ kind, label, icon: Icon }) => {
                const group = items.filter((i) => i.kind === kind && !i.generated);
                if (!group.length) return null;
                return (
                  <section key={kind} className="pt-2">
                    <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                      {label} <span className="font-mono">{group.length}</span>
                    </h3>
                    {group.map((item) => (
                      <Row key={item.id} icon={Icon} title={item.name} sub={`${item.folder} · ${item.sizeMb} MB`} onClick={() => pick({ type: "library", id: item.id })} />
                    ))}
                  </section>
                );
              })}
              {!q && (
                <section className="pt-2">
                  <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Generated demos</h3>
                  {DEMOS.map((d) => (
                    <Row key={d.kind} icon={d.icon} title={d.label} sub="No licenses, made on your machine" onClick={() => pick({ type: "demo", kind: d.kind })} />
                  ))}
                </section>
              )}
              {q && !items.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
            </div>
          </>
        )}

        <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-2">
          <button
            onClick={() => {
              setOpen(false);
              props.onUpload();
            }}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-foreground px-3 text-[13px] text-white hover:bg-foreground/85"
          >
            <Upload className="size-3.5" strokeWidth={1.5} /> Upload
          </button>
          <button onClick={props.onRefresh} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] hover:bg-muted" title="Read the folders again">
            <RefreshCw className="size-3.5" strokeWidth={1.5} /> Refresh
          </button>
          <span
            className="ml-auto inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground"
            title={`Folders: ${props.library?.folders.join(" · ") ?? ""}\nConfigure them in ~/.audiofx/library.json or with AUDIOFX_LIBRARY.`}
          >
            <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.5} />
            {props.library?.folders.length ?? 0} folders
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, title, sub, accent, onClick }: { icon: LucideIcon; title: string; sub: string; accent?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-muted">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", accent ? "bg-foreground text-white" : "bg-muted")}>
        <Icon className="size-4" strokeWidth={1.5} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
