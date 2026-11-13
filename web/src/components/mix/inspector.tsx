import { Headphones, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EFFECTS, getEffect, resolveParams } from "../../../../src/core/registry";
import { CATEGORY_LABELS, type NumberParam, type ParamSpec, type ParamValue } from "../../../../src/core/types";
import { syncOffset, useWave, type Analysis } from "../../mix-api";
import {
  clipLength,
  clipSpan,
  findClip,
  findMoment,
  LOUDNESS_TARGETS,
  momentExtent,
  momentInfo,
  ROLE_COLORS,
  ROLE_LABELS,
  type Align,
  type ClipDoc,
  type MixDoc,
  type MomentDoc,
  type Selection,
  type TrackDoc,
} from "../../mix-store";
import type { Player } from "../../player";
import { toStep } from "../../steps";
import { formatTime } from "../../visuals";
import { ParamControl, StepCard, type SampleOption, type Step } from "@/components/chain";
import { Button } from "@/components/ui/button";
import { CATEGORY_ICONS } from "@/icons";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";

export interface InspectorProps {
  doc: MixDoc;
  selection: Selection;
  player: Player;
  /** Library samples a file param (layer) can pick. */
  samples: SampleOption[];
  analysis: Analysis | null;
  /** The analysis is of an older render than what you hear. */
  analysisStale: boolean;
  /** `group` makes a slider drag one undo step. */
  onEditClip: (id: string, patch: Partial<ClipDoc>, group?: string) => void;
  onEditMoment: (id: string, patch: Partial<MomentDoc>, group?: string) => void;
  onEditTrack: (id: string, patch: Partial<TrackDoc>, group?: string) => void;
  onLoudness: (value: number | null) => void;
  onRemove: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  /** Plays from a little before a time. */
  onAudition: (t: number) => void;
  onClose: () => void;
}

const num = (spec: Omit<NumberParam, "type" | "default"> & { default?: number }): NumberParam => ({ type: "number", default: 0, ...spec });

/** The playhead, updated a few times a second: what "Use the playhead" takes. */
function useCoarseTime(player: Player) {
  const [t, setT] = useState(player.time);
  useEffect(() => {
    const timer = setInterval(() => setT((prev) => (Math.abs(prev - player.time) > 0.02 ? player.time : prev)), 250);
    return () => clearInterval(timer);
  }, [player]);
  return t;
}

/**
 * What is selected, and its settings: a clip (place, trim, gain, fades, alignment and its effect chain), a
 * moment (where it lands and its sound), a track (gain, mute, solo, ducking) or the master (loudness).
 */
export function Inspector(props: InspectorProps) {
  const { doc, selection } = props;
  const playhead = useCoarseTime(props.player);
  if (selection.kind === "clip") {
    const found = findClip(doc, selection.id);
    if (found) return <ClipPanel {...props} clip={found.clip} track={found.track} playhead={playhead} />;
  }
  if (selection.kind === "moment") {
    const found = findMoment(doc, selection.id);
    if (found) return <MomentPanel {...props} moment={found.moment} track={found.track} playhead={playhead} />;
  }
  if (selection.kind === "track") {
    const track = doc.tracks.find((t) => t.id === selection.id);
    if (track) return <TrackPanel {...props} track={track} />;
  }
  return <MasterPanel {...props} />;
}

function Panel(props: { eyebrow: ReactNode; title: string; actions?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <section aria-label="Inspector" className="animate-rise min-w-0 rounded-[28px] bg-card p-5 shadow-card sm:p-6" data-inspector>
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{props.eyebrow}</p>
          <h2 className="mt-0.5 truncate font-display text-[24px] leading-tight font-light tracking-[-0.03em]" title={props.title}>
            {props.title}
          </h2>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">
          {props.actions}
          {props.onClose && (
            <Button size="icon-sm" variant="ghost" onClick={props.onClose} aria-label="Back to the master" title="Back to the master (Esc)">
              <X strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </header>
      <div className="mt-5 space-y-6">{props.children}</div>
    </section>
  );
}

/** A titled block of controls; `pairs` sets short controls (sliders, bare numbers) two to a row. */
function Group({ title, note, pairs, children }: { title: string; note?: ReactNode; pairs?: boolean; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{note}</p>}
      <div className={cn("mt-3 grid gap-x-6 gap-y-3", pairs && "sm:grid-cols-2")}>{children}</div>
    </div>
  );
}

function Pills<T extends string | number | null>(props: { label: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 sm:col-span-2" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={props.value === o.value}
          onClick={() => props.onChange(o.value)}
          title={o.hint}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
            props.value === o.value ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong",
          )}
        >
          {o.label}
          {o.hint && <span className={cn("font-mono text-[11px]", props.value === o.value ? "text-white/70" : "text-muted-foreground")}>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

const ALIGNS: { value: Align; label: string; hint: string }[] = [
  { value: "start", label: "Start", hint: "Its first sample lands on the position" },
  { value: "onset", label: "Attack", hint: "Its attack lands on the position (measured from the file)" },
  { value: "peak", label: "Loudest point", hint: "Its loudest point lands on the position (whooshes)" },
];

function ClipPanel(props: InspectorProps & { clip: ClipDoc; track: TrackDoc; playhead: number }) {
  const { clip, track, playhead } = props;
  const length = clipLength(clip);
  const set = (patch: Partial<ClipDoc>, field?: string) => props.onEditClip(clip.id, patch, field && `${clip.id}:${field}`);
  const setSteps = (steps: Step[], field?: string) => set({ steps }, field);
  // Time params of the clip's effects count from the clip's first sample (before `at` for an aligned sample).
  const wave = useWave(clip.sourceId, props.player.ctx);
  const first = clipSpan(clip, syncOffset(wave, clip.start, length, clip.align)).from;
  const inClip = Math.max(0, Math.round((playhead - first) * 100) / 100);
  const fadeMax = Math.max(0.01, Math.min(10, length));
  return (
    <Panel
      eyebrow={
        <>
          <span className="size-2 rounded-full" style={{ background: ROLE_COLORS[track.role] }} aria-hidden /> Clip on {track.name}
        </>
      }
      title={clip.name}
      onClose={props.onClose}
      actions={
        <>
          <Button size="icon-sm" variant="ghost" onClick={() => props.onAudition(first)} aria-label="Listen from just before it" title="Listen from just before it">
            <Headphones strokeWidth={1.5} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => props.onRemove(clip.id)} aria-label="Remove the clip" title="Remove (Delete)">
            <Trash2 strokeWidth={1.5} />
          </Button>
        </>
      }
    >
      <Group title="Place" note={`${clip.fileName} · ${clip.duration.toFixed(2)} s · plays ${length.toFixed(2)} s`}>
        <ParamControl
          spec={num({ id: "at", label: clip.align === "start" ? "Starts at" : clip.align === "onset" ? "Attack at" : "Loudest point at", min: 0, max: 3600, unit: "s" })}
          value={clip.at}
          moment={Math.round(playhead * 100) / 100}
          momentLabel="Use the playhead"
          samples={[]}
          onChange={(v) => set({ at: Math.max(0, Number(v)) }, "at")}
        />
        <div>
          <span className="mb-1.5 block text-[13px] text-muted-foreground">What lands on that time</span>
          <Pills label="Alignment" value={clip.align} options={ALIGNS.map(({ value, label }) => ({ value, label }))} onChange={(align) => set({ align })} />
          <p className="mt-1.5 text-xs text-muted-foreground">{ALIGNS.find((a) => a.value === clip.align)!.hint}.</p>
        </div>
      </Group>

      <Group title="Trim" pairs note="Drag the clip's edges on the timeline, or type the seconds.">
        <ParamControl
          spec={num({ id: "start", label: "Skip from the file's start", min: 0, max: Math.max(60, clip.duration), unit: "s", moment: false })}
          value={clip.start}
          moment={0}
          samples={[]}
          onChange={(v) => {
            const start = Math.min(Math.max(0, Number(v)), clip.duration - 0.05);
            set({ start, length: clip.length === null ? null : Math.min(clip.length, clip.duration - start) }, "start");
          }}
        />
        <ParamControl
          spec={num({ id: "length", label: "Length", min: 0.05, max: Math.max(60, clip.duration), unit: "s", moment: false })}
          value={Math.round(length * 100) / 100}
          moment={0}
          samples={[]}
          onChange={(v) => set({ length: Math.min(Math.max(0.05, Number(v)), clip.duration - clip.start) }, "length")}
        />
      </Group>

      <Group title="Level" pairs>
        <ParamControl spec={num({ id: "gain", label: "Gain", min: -30, max: 12, step: 0.1, unit: "dB" })} value={clip.gain} moment={0} samples={[]} onChange={(v) => set({ gain: Number(v) }, "gain")} />
        <span className="hidden sm:block" />
        <ParamControl
          spec={num({ id: "fadeIn", label: "Fade in", min: 0, max: fadeMax, step: 0.01, unit: "s" })}
          value={clip.fadeIn}
          moment={0}
          samples={[]}
          onChange={(v) => set({ fadeIn: Math.min(Number(v), length - clip.fadeOut) }, "fadeIn")}
        />
        <ParamControl
          spec={num({ id: "fadeOut", label: "Fade out", min: 0, max: fadeMax, step: 0.01, unit: "s" })}
          value={clip.fadeOut}
          moment={0}
          samples={[]}
          onChange={(v) => set({ fadeOut: Math.min(Number(v), length - clip.fadeIn) }, "fadeOut")}
        />
      </Group>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-medium">
            Effects <span className="font-mono text-xs text-muted-foreground">{clip.steps.length || ""}</span>
          </h3>
          <EffectPicker onPick={(id) => setSteps([...clip.steps, toStep({ effect: id, params: getEffect(id).timed ? { at: inClip } : undefined })])} />
        </div>
        <p className="mt-0.5 text-xs text-pretty text-muted-foreground">On this clip only, in order. Times count from the clip's first sample.</p>
        <div className="mt-3 space-y-3">
          {clip.steps.map((step, index) => (
            <StepCard
              key={step.key}
              step={step}
              index={index}
              total={clip.steps.length}
              duration={length}
              moment={inClip}
              momentLabel="Use the playhead"
              samples={props.samples}
              onParam={(id: string, v: ParamValue) => setSteps(clip.steps.map((s) => (s.key === step.key ? { ...s, params: { ...s.params, [id]: v } } : s)), `${step.key}:${id}`)}
              onUpdate={(patch) => setSteps(clip.steps.map((s) => (s.key === step.key ? { ...s, ...patch } : s)), `${step.key}:window`)}
              onMove={(d) => {
                const next = [...clip.steps];
                const [item] = next.splice(index, 1);
                next.splice(Math.max(0, Math.min(next.length, index + d)), 0, item);
                setSteps(next);
              }}
              onReset={() => setSteps(clip.steps.map((s) => (s.key === step.key ? { ...s, params: resolveParams(getEffect(s.effect)) } : s)))}
              onRemove={() => setSteps(clip.steps.filter((s) => s.key !== step.key))}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MomentPanel(props: InspectorProps & { moment: MomentDoc; track: TrackDoc; playhead: number }) {
  const { moment, track, playhead } = props;
  const info = momentInfo(moment.kind);
  const extent = momentExtent(moment);
  const setParam = (index: number, id: string, value: ParamValue) =>
    props.onEditMoment(moment.id, { steps: moment.steps.map((s, i) => (i === index ? { ...s, params: { ...s.params, [id]: value } } : s)) }, `${moment.id}:${index}:${id}`);
  return (
    <Panel
      eyebrow={
        <>
          <span className="size-2 rounded-full bg-[var(--moment)]" aria-hidden /> Moment on {track.name}
        </>
      }
      title={info.label}
      onClose={props.onClose}
      actions={
        <>
          <Button size="icon-sm" variant="ghost" onClick={() => props.onAudition(moment.at)} aria-label="Listen from just before it" title="Listen from just before it">
            <Headphones strokeWidth={1.5} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => props.onRemove(moment.id)} aria-label="Remove the moment" title="Remove (Delete)">
            <Trash2 strokeWidth={1.5} />
          </Button>
        </>
      }
    >
      <Group title="Where it lands" note={`${info.hint}. Its sound covers ${formatTime(extent.from)}–${formatTime(extent.to)} (before reverb tails).`}>
        <ParamControl
          spec={num({ id: "at", label: "At", min: 0, max: 3600, unit: "s" })}
          value={moment.at}
          moment={Math.round(playhead * 100) / 100}
          momentLabel="Use the playhead"
          samples={[]}
          onChange={(v) => props.onEditMoment(moment.id, { at: Math.max(0, Number(v)) }, `${moment.id}:at`)}
        />
      </Group>
      {moment.steps.map((step, index) => {
        const effect = getEffect(step.effect);
        const specs = effect.params.filter((p: ParamSpec) => p.id !== "at");
        return (
          <Group key={index} title={effect.name} note={effect.description} pairs>
            {specs.map((spec) => (
              <ParamControl key={spec.id} spec={spec} value={step.params[spec.id] ?? spec.default} moment={moment.at} samples={props.samples} onChange={(v) => setParam(index, spec.id, v)} />
            ))}
          </Group>
        );
      })}
    </Panel>
  );
}

function TrackPanel(props: InspectorProps & { track: TrackDoc }) {
  const { track } = props;
  const set = (patch: Partial<TrackDoc>, field?: string) => props.onEditTrack(track.id, patch, field && `${track.id}:${field}`);
  const items = track.clips.length + track.moments.length;
  return (
    <Panel
      eyebrow={
        <>
          <span className="size-2 rounded-full" style={{ background: ROLE_COLORS[track.role] }} aria-hidden /> {ROLE_LABELS[track.role]} track
          {items > 0 && <span className="font-mono">· {items}</span>}
        </>
      }
      title={track.name}
      onClose={props.onClose}
      actions={
        <Button size="icon-sm" variant="ghost" onClick={() => props.onRemoveTrack(track.id)} aria-label="Remove the track" title={items ? "Remove the track and what is on it (undo brings it back)" : "Remove the track"}>
          <Trash2 strokeWidth={1.5} />
        </Button>
      }
    >
      <Group title="Track" pairs>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[13px] text-muted-foreground">Name</span>
          <input
            className="h-9 w-full rounded-full bg-muted px-3.5 text-sm outline-none focus:bg-card focus:shadow-ring"
            value={track.name}
            maxLength={40}
            onChange={(e) => set({ name: e.target.value }, "name")}
            onBlur={(e) => !e.target.value.trim() && set({ name: ROLE_LABELS[track.role] })}
          />
        </label>
        <ParamControl spec={num({ id: "gain", label: "Gain", min: -30, max: 12, step: 0.1, unit: "dB" })} value={track.gain} moment={0} samples={[]} onChange={(v) => set({ gain: Number(v) }, "gain")} />
        <div className="flex flex-wrap items-end gap-4">
          <ParamControl spec={{ type: "bool", id: "mute", label: "Mute", default: false }} value={track.mute} moment={0} samples={[]} onChange={(v) => set({ mute: Boolean(v) })} />
          <ParamControl spec={{ type: "bool", id: "solo", label: "Solo", default: false }} value={track.solo} moment={0} samples={[]} onChange={(v) => set({ solo: Boolean(v) })} />
        </div>
      </Group>

      {track.role === "music" && (
        <Group title="Ducking" pairs note="The music dips by this much while a voice track plays, and comes back after it. Voices duck it even when a solo hides them.">
          <div className="sm:col-span-2">
            <ParamControl spec={{ type: "bool", id: "duck", label: "Duck under the voice", default: true }} value={track.duck} moment={0} samples={[]} onChange={(v) => set({ duck: Boolean(v) })} />
          </div>
          <div className={cn("contents", !track.duck && "[&>*]:pointer-events-none [&>*]:opacity-40")}>
            <ParamControl spec={num({ id: "depth", label: "Depth", min: 0, max: 40, step: 0.5, unit: "dB" })} value={track.duckDepth} moment={0} samples={[]} onChange={(v) => set({ duckDepth: Number(v) }, "duckDepth")} />
            <ParamControl spec={num({ id: "release", label: "Release", min: 50, max: 3000, step: 10, unit: "ms" })} value={track.duckRelease} moment={0} samples={[]} onChange={(v) => set({ duckRelease: Number(v) }, "duckRelease")} />
          </div>
        </Group>
      )}
      {track.role === "sfx" && (
        <p className="text-xs text-pretty text-muted-foreground">
          Moments (hit, whoosh, riser, braam, sub drop) are synthesized on this track at their time; samples are clips that land by their attack or loudest point. Tap a cut on the ruler to add either.
        </p>
      )}
    </Panel>
  );
}

function MasterPanel(props: InspectorProps) {
  const { doc, analysis } = props;
  return (
    <Panel
      eyebrow={
        <>
          <SlidersHorizontal className="size-3.5" strokeWidth={1.5} /> Master
        </>
      }
      title="Mix"
    >
      <Group title="Loudness" note="The master is normalized to this integrated loudness, then a limiter holds the true peak under −1 dBFS.">
        <Pills label="Loudness target" value={doc.loudness} options={LOUDNESS_TARGETS} onChange={props.onLoudness} />
      </Group>
      <div>
        <h3 className="text-[13px] font-medium">Measured on the render</h3>
        <p className="mt-0.5 text-xs text-pretty text-muted-foreground">By ffmpeg (EBU R128) on what you hear. Numbers describe the signal, not how it sounds.</p>
        <dl className={cn("mt-3 grid grid-cols-2 gap-x-6 gap-y-3 transition-opacity", props.analysisStale && "opacity-45")}>
          <Fact label="Integrated" value={analysis?.integratedLufs != null ? `${analysis.integratedLufs.toFixed(1)} LUFS` : "—"} />
          <Fact label="True peak" value={analysis?.truePeakDb != null ? `${analysis.truePeakDb.toFixed(1)} dBTP` : "—"} />
          <Fact label="Sample peak" value={analysis?.peakDb != null ? `${analysis.peakDb.toFixed(1)} dBFS` : "—"} />
          <Fact label="Length" value={analysis ? `${analysis.duration.toFixed(2)} s` : "—"} />
        </dl>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">Select a clip, a moment or a track name to edit it here.</p>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] tabular-nums">{value}</dd>
    </div>
  );
}

/** Adds an effect to a clip's chain: every effect of the catalog, searchable, by category. */
function EffectPicker({ onPick }: { onPick: (id: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (anchor) requestAnimationFrame(() => input.current?.focus());
    else setQuery("");
  }, [anchor]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = EFFECTS.filter((e) => !q || `${e.name} ${e.id} ${e.tags.join(" ")} ${e.whenToUse} ${CATEGORY_LABELS[e.category]}`.toLowerCase().includes(q));
    const byCategory = new Map<string, typeof found>();
    for (const e of found) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]);
    return [...byCategory.entries()];
  }, [query]);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} aria-expanded={!!anchor}>
        <Plus strokeWidth={1.5} /> Add effect
      </Button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Add an effect" width={360} className="p-0">
        <div className="sticky top-0 z-10 bg-card p-2 pb-1">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
            <input
              ref={input}
              className="h-10 w-full rounded-full bg-muted pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
              placeholder="Search effects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groups[0]?.[1][0]) {
                  onPick(groups[0][1][0].id);
                  setAnchor(null);
                }
              }}
            />
          </label>
        </div>
        <div className="px-2 pb-2">
          {groups.map(([category, effects]) => {
            const Icon = CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS];
            return (
              <section key={category} className="pt-2">
                <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}</h4>
                {effects.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      onPick(e.id);
                      setAnchor(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-4" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{e.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.whenToUse}</span>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
          {!groups.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
        </div>
      </Popover>
    </>
  );
}
