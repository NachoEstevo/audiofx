import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  clipLength,
  clipSpan,
  ROLE_COLORS,
  snapTo,
  toFrame,
  type ClipDoc,
  type Cut,
  type MixDoc,
  type MomentDoc,
  type Selection,
  type SnapTarget,
  type TrackDoc,
} from "../../mix-store";
import type { Player } from "../../player";
import { formatTime } from "../../visuals";
import { ClipBlock, MomentBlock, type BlockHandlers, type DragMode } from "./clip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_PPS = 400;
const MIN_LENGTH = 0.05;
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

interface Drag {
  kind: "clip" | "moment";
  id: string;
  mode: DragMode;
  pointerId: number;
  x0: number;
  moved: boolean;
  touch: boolean;
  clip?: ClipDoc;
  moment?: MomentDoc;
  sync: number;
  targets: SnapTarget[];
}

type Preview = { id: string; clip?: Partial<ClipDoc>; moment?: Partial<MomentDoc>; snap: SnapTarget | null };

export interface TimelineProps {
  doc: MixDoc;
  /** Seconds the timeline covers. */
  span: number;
  fps: number | null;
  player: Player;
  cuts: Cut[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onSeek: (t: number) => void;
  onEditClip: (id: string, patch: Partial<ClipDoc>) => void;
  onEditMoment: (id: string, patch: Partial<MomentDoc>) => void;
  onEditTrack: (id: string, patch: Partial<TrackDoc>) => void;
  /** A cut marker was clicked: the screen offers moments at its time. */
  onCut: (cut: Cut, anchor: HTMLElement) => void;
  /** The add buttons of a track's header. */
  trackTools: (track: TrackDoc) => ReactNode;
  /** What an empty lane offers. */
  laneHint: (track: TrackDoc) => ReactNode;
  /** Shown above the ruler on the left: what the cut detection found. */
  cutsLabel: ReactNode;
  /** Actions of the toolbar (undo, suggest, add a track...). */
  toolbar: ReactNode;
  ctx: BaseAudioContext;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * The timeline under the picture: a time ruler with the cuts (stronger cuts drawn stronger), the playhead
 * and one lane per track. Clips and moments are dragged with the pointer (mouse or touch) and snap to cuts
 * and to the playhead within a few pixels; a click on the ruler or a lane seeks. It fits the whole length
 * to the width, zooms (buttons, slider, Ctrl+wheel) and scrolls sideways when zoomed and on a phone.
 */
export function Timeline(props: TimelineProps) {
  const { doc, span, fps, player, cuts, selection } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ width: 0, left: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [preview, setPreviewState] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const setPreview = (p: Preview | null) => {
    previewRef.current = p;
    setPreviewState(p);
  };
  const drag = useRef<Drag | null>(null);
  const lanePress = useRef<{ x: number; y: number; track: string } | null>(null);

  const fit = view.width > 0 ? view.width / Math.max(span, 1) : 40;
  const pps = Math.max(fit, Math.min(MAX_PPS, zoom ?? fit));
  const width = Math.max(view.width, span * pps);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView({ width: el.clientWidth, left: el.scrollLeft }));
    };
    setView({ width: el.clientWidth, left: el.scrollLeft });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    // Ctrl (or ⌘) + wheel zooms around the pointer.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const at = (el.scrollLeft + x) / ppsRef.current;
      const next = clamp(ppsRef.current * Math.exp(-e.deltaY * 0.0025), el.clientWidth / Math.max(span, 1), MAX_PPS);
      setZoom(next);
      requestAnimationFrame(() => (el.scrollLeft = at * next - x));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", wheel);
    };
  }, [span]);

  // Zooming keeps the playhead (or the middle of the view) where it was on screen.
  const lastPps = useRef(pps);
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = lastPps.current;
    lastPps.current = pps;
    if (!el || before === pps) return;
    const t = player.time;
    const inView = t * before >= el.scrollLeft && t * before <= el.scrollLeft + el.clientWidth;
    const anchor = inView ? t : (el.scrollLeft + el.clientWidth / 2) / before;
    const x = anchor * before - el.scrollLeft;
    el.scrollLeft = anchor * pps - x;
  }, [pps, player]);

  // The playhead moves every frame without re-rendering React, and the view follows it while playing.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const x = player.time * ppsRef.current;
      if (playhead.current) playhead.current.style.transform = `translateX(${x}px)`;
      const el = scroller.current;
      if (el && player.playing && !drag.current && (x > el.scrollLeft + el.clientWidth - 16 || x < el.scrollLeft)) el.scrollLeft = x - el.clientWidth * 0.1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player]);

  /** Seconds at a pointer's position over the content. */
  const timeAt = useCallback((clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / ppsRef.current);
  }, []);
  const contentX = (clientX: number) => {
    const el = scroller.current!;
    return clientX - el.getBoundingClientRect().left + el.scrollLeft;
  };

  const targets = (): SnapTarget[] => [...cuts.map((c) => ({ time: c.time, label: `Cut ${formatTime(c.time)}` })), { time: player.time, label: "Playhead" }];

  const handlersFor = (kind: "clip" | "moment", item: ClipDoc | MomentDoc, sync: number): BlockHandlers => ({
    onPointerDown: (e, mode) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        kind,
        id: item.id,
        mode,
        pointerId: e.pointerId,
        x0: contentX(e.clientX),
        moved: false,
        touch: e.pointerType === "touch",
        clip: kind === "clip" ? (item as ClipDoc) : undefined,
        moment: kind === "moment" ? (item as MomentDoc) : undefined,
        sync,
        targets: targets(),
      };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const el = scroller.current!;
      const rect = el.getBoundingClientRect();
      // Near an edge, the view scrolls so a block can travel past what is shown.
      if (e.clientX > rect.right - 28) el.scrollLeft += 14;
      else if (e.clientX < rect.left + 28) el.scrollLeft -= 14;
      const dx = contentX(e.clientX) - d.x0;
      if (!d.moved && Math.abs(dx) < 4) return;
      d.moved = true;
      const pps = ppsRef.current;
      const dt = dx / pps;
      const tolerance = (d.touch ? 14 : 8) / pps;
      if (d.moment) {
        const s = snapTo([d.moment.at + dt], d.targets, tolerance);
        const at = Math.max(0, s ? d.moment.at + dt + s.delta : toFrame(d.moment.at + dt, fps));
        return setPreview({ id: d.id, moment: { at }, snap: s?.target ?? null });
      }
      const c = d.clip!;
      const length = clipLength(c);
      const placed = clipSpan(c, d.sync);
      if (d.mode === "move") {
        const edges = [placed.from + dt, placed.to + dt, ...(c.align === "start" ? [] : [c.at + dt])];
        const s = snapTo(edges, d.targets, tolerance);
        const at = Math.max(0, s ? c.at + dt + s.delta : toFrame(c.at + dt, fps));
        return setPreview({ id: d.id, clip: { at }, snap: s?.target ?? null });
      }
      if (d.mode === "trim-start") {
        const s = snapTo([c.at + dt], d.targets, tolerance);
        const from = s ? c.at + dt + s.delta : toFrame(c.at + dt, fps);
        // Not before the file's first sample, not before 0, and some clip left.
        const delta = clamp(from - c.at, Math.max(-c.start, -c.at), length - MIN_LENGTH);
        return setPreview({ id: d.id, clip: { at: c.at + delta, start: c.start + delta, length: length - delta }, snap: s && Math.abs(from - c.at - delta) < 1e-6 ? s.target : null });
      }
      const s = snapTo([placed.to + dt], d.targets, tolerance);
      const to = s ? placed.to + dt + s.delta : toFrame(placed.to + dt, fps);
      const next = clamp(to - placed.from, MIN_LENGTH, c.duration - c.start);
      setPreview({ id: d.id, clip: { length: next }, snap: s && Math.abs(to - placed.from - next) < 1e-6 ? s.target : null });
    },
    onPointerUp: (e) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      drag.current = null;
      if (!d.moved) {
        props.onSelect({ kind: d.kind, id: d.id });
        return;
      }
      const p = previewRef.current;
      setPreview(null);
      if (p?.id === d.id) {
        if (p.clip) props.onEditClip(d.id, p.clip);
        else if (p.moment) props.onEditMoment(d.id, p.moment);
      }
      props.onSelect({ kind: d.kind, id: d.id });
    },
    onPointerCancel: () => {
      drag.current = null;
      setPreview(null);
    },
  });

  // Ruler: press to seek, drag to scrub.
  const scrubbing = useRef<number | null>(null);
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = e.pointerId;
    props.onSeek(timeAt(e.clientX));
  };
  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === e.pointerId) props.onSeek(timeAt(e.clientX));
  };
  const onRulerUp = () => (scrubbing.current = null);

  // Lanes: a tap (not a swipe) on empty space seeks and selects the track.
  const onLaneDown = (e: ReactPointerEvent<HTMLDivElement>, track: TrackDoc) => {
    if (e.button === 0) lanePress.current = { x: e.clientX, y: e.clientY, track: track.id };
  };
  const onLaneUp = (e: ReactPointerEvent<HTMLDivElement>, track: TrackDoc) => {
    const press = lanePress.current;
    lanePress.current = null;
    if (!press || press.track !== track.id || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) return;
    props.onSeek(timeAt(e.clientX));
    props.onSelect({ kind: "track", id: track.id });
  };

  const tick = TICK_STEPS.find((s) => s * pps >= 64) ?? 600;
  const minor = (tick / 5) * pps >= 6 ? tick / 5 : null;
  const labels = useMemo(() => {
    const first = Math.max(0, Math.floor((view.left / pps - tick) / tick) * tick);
    const last = Math.min(span, (view.left + view.width) / pps + tick);
    const out: number[] = [];
    for (let t = first; t <= last + 1e-9; t += tick) out.push(Math.round(t * 1000) / 1000);
    return out;
  }, [view, pps, tick, span]);

  const zoomPos = fit >= MAX_PPS ? 0 : Math.round((Math.log(pps / fit) / Math.log(MAX_PPS / fit)) * 1000);
  const setZoomPos = (pos: number) => setZoom(pos <= 0 ? null : fit * Math.pow(MAX_PPS / fit, pos / 1000));

  return (
    // isolate: the playhead and blocks stack among themselves, under the sticky header and the phone's transport.
    <section aria-label="Timeline" className="isolate min-w-0 rounded-[28px] bg-card p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-3">
        <h2 className="mr-1 font-display text-lg tracking-[-0.02em]">Timeline</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{props.toolbar}</div>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon-sm" variant="ghost" onClick={() => setZoomPos(zoomPos - 150)} disabled={zoomPos <= 0} aria-label="Zoom out" title="Zoom out (Ctrl+wheel)">
            <Minus strokeWidth={1.5} />
          </Button>
          <input
            type="range"
            min={0}
            max={1000}
            value={zoomPos}
            onChange={(e) => setZoomPos(Number(e.target.value))}
            className="slider w-20 sm:w-28"
            style={{ "--fill": `${zoomPos / 10}%` } as React.CSSProperties}
            aria-label="Zoom"
            disabled={fit >= MAX_PPS}
          />
          <Button size="icon-sm" variant="ghost" onClick={() => setZoomPos(zoomPos + 150)} disabled={zoomPos >= 1000 || fit >= MAX_PPS} aria-label="Zoom in" title="Zoom in (Ctrl+wheel)">
            <Plus strokeWidth={1.5} />
          </Button>
          <Button size="sm" variant={zoom === null ? "primary" : "ghost"} onClick={() => setZoom(null)} aria-pressed={zoom === null} title="Fit the whole length">
            <Maximize2 strokeWidth={1.5} /> Fit
          </Button>
        </div>
      </div>

      {/* Not overflow-hidden: a track's add panel opens from its header over the lanes. */}
      <div className="flex rounded-2xl shadow-ring">
        <div className="w-[112px] shrink-0 rounded-l-2xl border-r border-border bg-card sm:w-[176px]">
          <div className="flex h-8 items-center truncate border-b border-border px-2 text-[11px] text-muted-foreground sm:px-3">{props.cutsLabel}</div>
          {doc.tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              selected={selection.kind === "track" && selection.id === track.id}
              onSelect={() => props.onSelect({ kind: "track", id: track.id })}
              onToggle={(patch) => props.onEditTrack(track.id, patch)}
              tools={props.trackTools(track)}
            />
          ))}
        </div>

        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-r-2xl" data-timeline-scroller>
          {/* Clipped sideways to the length: a tail past the end (not rendered) must not widen the scroll. */}
          <div className="relative overflow-x-clip" style={{ width }}>
            <div
              className="relative h-8 cursor-pointer touch-none border-b border-border select-none"
              style={
                minor
                  ? { backgroundImage: `repeating-linear-gradient(to right, var(--color-border) 0 1px, transparent 1px ${minor * pps}px)`, backgroundSize: `100% 6px`, backgroundRepeat: "repeat-x", backgroundPosition: "0 100%" }
                  : undefined
              }
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={onRulerUp}
              onPointerCancel={onRulerUp}
              aria-label="Time ruler: press to move the playhead"
            >
              {labels.map((t) => (
                <span key={t} className="pointer-events-none absolute top-0 h-full border-l border-border pl-1 font-mono text-[10px] leading-5 text-muted-foreground tabular-nums" style={{ left: t * pps }}>
                  {tick < 1 ? formatTime(t) : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`}
                </span>
              ))}
              {cuts.map((cut) => {
                const strength = clamp((cut.score - 8) / 40, 0.12, 1);
                return (
                  <button
                    key={cut.time}
                    type="button"
                    className="group absolute bottom-0 z-10 flex h-full w-4 -translate-x-1/2 cursor-pointer items-end justify-center outline-none focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]"
                    style={{ left: cut.time * pps }}
                    aria-label={`Cut at ${formatTime(cut.time)}, score ${cut.score.toFixed(1)}: add a moment`}
                    data-cut={cut.time}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => props.onCut(cut, e.currentTarget)}
                  >
                    <span className="block w-[3px] rounded-t-full bg-foreground transition-[height] group-hover:bg-[var(--moment)]" style={{ height: 6 + 18 * strength, opacity: 0.25 + 0.75 * strength }} />
                    <span className="pointer-events-none absolute top-full left-1/2 z-40 mt-1 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {formatTime(cut.time)} · score {cut.score.toFixed(1)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative">
              {doc.tracks.map((track) => (
                <div
                  key={track.id}
                  className={cn("relative h-14 border-b border-border last:border-b-0 sm:h-16", selection.kind === "track" && selection.id === track.id && "bg-muted/50")}
                  onPointerDown={(e) => onLaneDown(e, track)}
                  onPointerUp={(e) => onLaneUp(e, track)}
                  data-lane={track.id}
                >
                  {track.clips.map((clip) => {
                    const shown = preview?.id === clip.id && preview.clip ? { ...clip, ...preview.clip } : clip;
                    return (
                      <ClipBlock
                        key={clip.id}
                        clip={shown}
                        role={track.role}
                        pps={pps}
                        ctx={props.ctx}
                        selected={selection.kind === "clip" && selection.id === clip.id}
                        handlers={(sync) => handlersFor("clip", clip, sync)}
                      />
                    );
                  })}
                  {track.moments.map((moment) => {
                    const shown = preview?.id === moment.id && preview.moment ? { ...moment, ...preview.moment } : moment;
                    return (
                      <MomentBlock
                        key={moment.id}
                        moment={shown}
                        pps={pps}
                        selected={selection.kind === "moment" && selection.id === moment.id}
                        handlers={handlersFor("moment", moment, 0)}
                      />
                    );
                  })}
                  {!track.clips.length && !track.moments.length && (
                    <div className="pointer-events-none sticky left-0 flex h-full w-fit max-w-[min(100%,420px)] items-center px-3">{props.laneHint(track)}</div>
                  )}
                </div>
              ))}
              {cuts.map((cut) => (
                <div
                  key={cut.time}
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
                  style={{ left: cut.time * pps, opacity: 0.05 + 0.16 * clamp((cut.score - 8) / 40, 0, 1) }}
                />
              ))}
            </div>

            {preview?.snap && (
              <div className="pointer-events-none absolute inset-y-0 z-40 w-[2px] -translate-x-1/2 bg-[var(--moment)]" style={{ left: preview.snap.time * pps }}>
                <span className="absolute top-1 left-1.5 rounded-full bg-[var(--moment)] px-1.5 py-px text-[10px] whitespace-nowrap text-white">{preview.snap.label}</span>
              </div>
            )}
            <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 z-30 w-px bg-foreground" aria-hidden>
              <span className="absolute top-0 -left-[5px] size-[11px] rounded-full border-2 border-white bg-foreground shadow" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackHeader(props: { track: TrackDoc; selected: boolean; onSelect: () => void; onToggle: (patch: Partial<TrackDoc>) => void; tools: ReactNode }) {
  const { track } = props;
  return (
    <div
      className={cn("relative flex h-14 cursor-pointer flex-col justify-center gap-1 border-b border-border px-2 last:border-b-0 sm:h-16 sm:px-3", props.selected && "bg-muted/60")}
      onClick={(e) => e.target === e.currentTarget && props.onSelect()}
      data-track-header={track.id}
    >
      <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left" onClick={props.onSelect} title={`${track.name}: track settings`}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: ROLE_COLORS[track.role] }} aria-hidden />
        <span className="truncate text-[13px]">{track.name}</span>
        {track.role === "music" && track.duck && <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">ducks −{track.duckDepth} dB</span>}
      </button>
      <div className="flex items-center gap-1">
        <Toggle on={track.mute} label="M" title={track.mute ? "Muted: tap to hear it" : "Mute"} onClick={() => props.onToggle({ mute: !track.mute })} />
        <Toggle on={track.solo} label="S" title={track.solo ? "Soloed: tap to hear every track" : "Solo"} onClick={() => props.onToggle({ solo: !track.solo })} />
        {props.tools}
      </div>
    </div>
  );
}

function Toggle({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={title}
      title={title}
      className={cn("grid size-6 cursor-pointer place-items-center rounded-full font-mono text-[11px] transition-colors", on ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong")}
    >
      {label}
    </button>
  );
}
