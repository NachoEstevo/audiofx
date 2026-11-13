import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { syncOffset, useWave, type Wave } from "../../mix-api";
import { clipLength, clipSpan, momentExtent, momentInfo, ROLE_COLORS, type ClipDoc, type MomentDoc, type Role } from "../../mix-store";
import { formatTime } from "../../visuals";
import { cn } from "@/lib/utils";

export type DragMode = "move" | "trim-start" | "trim-end";

/** Pointer handlers the timeline gives each block; the block says which part was grabbed. */
export interface BlockHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, mode: DragMode) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

/** The filled outline of a stretch of a waveform, in a viewBox `n` wide and 2 high (centre line at 1). */
function wavePath(wave: Wave | null, start: number, length: number): { d: string; n: number } | null {
  if (!wave || length <= 0) return null;
  const a = Math.max(0, Math.floor(start * wave.perSecond));
  const b = Math.min(wave.peaks.length, Math.ceil((start + length) * wave.perSecond));
  const n = b - a;
  if (n < 2) return null;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < n; i++) top.push(`${i},${(1 - wave.peaks[a + i] * 0.92).toFixed(3)}`);
  for (let i = n - 1; i >= 0; i--) bottom.push(`${i},${(1 + wave.peaks[a + i] * 0.92).toFixed(3)}`);
  return { d: `M${top.join(" ")}L${bottom.join(" ")}Z`, n: n - 1 };
}

/**
 * A clip on its lane: name, waveform, fades and, for samples aligned by attack or peak, the sync point that
 * lands on its position. Drag to move; drag its edges to trim. On touch, a clip is dragged once selected,
 * so a swipe over an unselected one still scrolls the timeline.
 */
export function ClipBlock(props: {
  clip: ClipDoc;
  role: Role;
  pps: number;
  ctx: BaseAudioContext;
  selected: boolean;
  /** Given the measured sync point (seconds into the clip), so a drag knows where the block starts. */
  handlers: (sync: number) => BlockHandlers;
}) {
  const { clip, pps } = props;
  const wave = useWave(clip.sourceId, props.ctx);
  const length = clipLength(clip);
  const sync = syncOffset(wave, clip.start, length, clip.align);
  const span = clipSpan(clip, sync);
  const handlers = props.handlers(sync);
  // Whatever would fall before 0 is trimmed by the engine: the block starts at 0.
  const from = Math.max(0, span.from);
  const hidden = from - span.from;
  const left = from * pps;
  const width = Math.max(3, (span.to - from) * pps);
  const path = useMemo(() => wavePath(wave, clip.start + hidden, length - hidden), [wave, clip.start, hidden, length]);
  const color = ROLE_COLORS[props.role];
  const trimmable = clip.align === "start";
  const fadeIn = Math.min(width, clip.fadeIn * pps);
  const fadeOut = Math.min(width, clip.fadeOut * pps);
  const anchorX = (span.anchor - from) * pps;

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-pressed={props.selected}
      aria-label={`${clip.name} at ${formatTime(clip.at)}`}
      data-clip={clip.id}
      className={cn(
        "group absolute inset-y-1.5 cursor-grab overflow-hidden rounded-lg bg-card shadow-ring select-none active:cursor-grabbing",
        props.selected ? "z-20 shadow-[0_0_0_1.5px_var(--color-foreground)]" : "z-0 hover:z-10",
      )}
      style={{ left, width, touchAction: props.selected ? "none" : "pan-x pan-y" }}
      onPointerDown={(e) => handlers.onPointerDown(e, "move")}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {path && (
        <svg viewBox={`0 0 ${path.n} 2`} preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-4 bottom-1 h-[calc(100%-1.25rem)] w-full" aria-hidden>
          <path d={path.d} fill={color} fillOpacity={0.42} />
        </svg>
      )}
      {(fadeIn > 1 || fadeOut > 1) && (
        <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {fadeIn > 1 && <path d={`M0,0 L${fadeIn},0 L0,100 Z`} fill="white" fillOpacity={0.62} />}
          {fadeOut > 1 && <path d={`M${width},0 L${width - fadeOut},0 L${width},100 Z`} fill="white" fillOpacity={0.62} />}
          {fadeIn > 1 && <path d={`M0,100 L${fadeIn},0`} stroke="var(--muted-foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />}
          {fadeOut > 1 && <path d={`M${width},100 L${width - fadeOut},0`} stroke="var(--muted-foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />}
        </svg>
      )}
      <span className="pointer-events-none absolute top-0.5 right-1.5 left-1.5 flex items-baseline gap-1.5 text-[11px] leading-4">
        <span className="truncate font-medium">{clip.name}</span>
        {clip.gain !== 0 && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{clip.gain > 0 ? "+" : "−"}{Math.abs(clip.gain).toFixed(1)} dB</span>}
        {clip.steps.length > 0 && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">fx {clip.steps.length}</span>}
      </span>
      {!trimmable && anchorX >= 0 && (
        <span
          className="pointer-events-none absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-[var(--moment)]"
          style={{ left: anchorX }}
          title={`Its ${clip.align === "onset" ? "attack" : "loudest point"} lands at ${formatTime(clip.at)}`}
        />
      )}
      {trimmable && (
        <span
          className={cn("absolute inset-y-0 left-0 w-2.5 cursor-ew-resize touch-none transition-opacity", props.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          onPointerDown={(e) => {
            e.stopPropagation();
            handlers.onPointerDown(e, "trim-start");
          }}
          aria-hidden
        >
          <span className="absolute inset-y-3 left-0.5 w-1 rounded-full bg-foreground/60" />
        </span>
      )}
      <span
        className={cn("absolute inset-y-0 right-0 w-2.5 cursor-ew-resize touch-none transition-opacity", props.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
        onPointerDown={(e) => {
          e.stopPropagation();
          handlers.onPointerDown(e, "trim-end");
        }}
        aria-hidden
      >
        <span className="absolute inset-y-3 right-0.5 w-1 rounded-full bg-foreground/60" />
      </span>
    </div>
  );
}

/**
 * A synthesized moment: the stretch its sound covers, faint, and a solid line where it lands. Only the
 * line and its label take the pointer, so clips under the faint stretch stay reachable.
 */
export function MomentBlock(props: { moment: MomentDoc; pps: number; selected: boolean; handlers: BlockHandlers }) {
  const { moment, pps, handlers } = props;
  const extent = momentExtent(moment);
  const left = extent.from * pps;
  const width = Math.max(4, (extent.to - extent.from) * pps);
  const anchorX = (moment.at - extent.from) * pps;
  const info = momentInfo(moment.kind);
  return (
    <div
      className={cn("pointer-events-none absolute inset-y-1.5 rounded-lg", props.selected ? "z-30 shadow-[0_0_0_1.5px_var(--moment)]" : "z-10")}
      style={{ left, width, background: "color-mix(in oklab, var(--moment) 9%, transparent)" }}
    >
      <div
        role="button"
        tabIndex={-1}
        aria-pressed={props.selected}
        aria-label={`${info.label} at ${formatTime(moment.at)}`}
        data-moment={moment.id}
        className="pointer-events-auto absolute inset-y-0 flex cursor-grab items-start select-none active:cursor-grabbing"
        style={{ left: anchorX - 6, touchAction: props.selected ? "none" : "pan-x pan-y" }}
        onPointerDown={(e) => handlers.onPointerDown(e, "move")}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        title={`${info.label} at ${formatTime(moment.at)} · ${info.hint}`}
      >
        <span className="mx-[5px] h-full w-[2px] rounded-full bg-[var(--moment)]" />
        <span className="mt-0.5 rounded-full bg-[var(--moment)] px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-white">{info.short}</span>
      </div>
    </div>
  );
}
