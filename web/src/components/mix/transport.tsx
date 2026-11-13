import { Braces, Clapperboard, Download, FileAudio, LoaderCircle, Pause, Play, SkipBack, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "../../mix-api";
import type { Player } from "../../player";
import { formatTime, usePlayerTime } from "../../visuals";
import type { RenderState } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MenuRow, Popover } from "./popover";

export type ExportKind = "wav" | "video" | "json";

/** Time with frames when the picture has a frame rate: what an editor reads off a timeline. */
function timecode(t: number, fps: number | null) {
  if (!fps) return formatTime(t);
  const whole = Math.floor(t + 1e-6);
  const frame = Math.floor((t - whole) * fps + 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}

/**
 * Play, the time, hold A for the video's own sound, a live output level and the export. On a phone it is a
 * bar fixed to the bottom of the screen so it stays reachable while the timeline scrolls.
 */
export function Transport(props: {
  player: Player;
  span: number;
  fps: number | null;
  render: RenderState;
  /** The video has its own sound to compare with. */
  canCompare: boolean;
  onHoldOriginal: (on: boolean) => void;
  exportMenu: React.ReactNode;
}) {
  const { player, render } = props;
  const time = usePlayerTime(player);
  const original = player.track === "original";
  return (
    <div
      className="z-30 flex items-center gap-2 bg-card/95 px-3 py-2 backdrop-blur-md max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:my-0 max-lg:border-t max-lg:border-border max-lg:pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:rounded-full lg:px-2 lg:shadow-ring"
      role="toolbar"
      aria-label="Transport"
      data-transport
    >
      <Button size="icon" variant="primary" onClick={() => player.toggle()} aria-label={player.playing ? "Pause (space)" : "Play (space)"} title={player.playing ? "Pause (space)" : "Play (space)"}>
        {player.playing ? <Pause fill="currentColor" strokeWidth={0} /> : <Play className="translate-x-px" fill="currentColor" strokeWidth={0} />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => player.seek(0)} aria-label="Back to the start (Home)" title="Back to the start (Home)" className="max-sm:hidden">
        <SkipBack strokeWidth={1.5} />
      </Button>
      <span className="min-w-0 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <span className="text-foreground">{timecode(time, props.fps)}</span>
        <span className="max-sm:hidden"> / {timecode(props.span, props.fps)}</span>
      </span>
      <button
        className={cn(
          "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 text-[13px] whitespace-nowrap shadow-ring transition-colors select-none disabled:cursor-not-allowed disabled:opacity-40",
          original ? "bg-foreground text-white" : "bg-card hover:bg-muted",
        )}
        disabled={!props.canCompare}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          props.onHoldOriginal(true);
        }}
        onPointerUp={() => props.onHoldOriginal(false)}
        onPointerCancel={() => props.onHoldOriginal(false)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !e.repeat && props.onHoldOriginal(true)}
        onKeyUp={(e) => (e.key === "Enter" || e.key === " ") && props.onHoldOriginal(false)}
        title={props.canCompare ? "Hold (or the A key) to hear the video's own sound" : "The video has no sound to compare with"}
      >
        <kbd className="font-mono text-[11px]">A</kbd>
        <span className="hidden xl:inline">{original ? "Video's sound" : "Hold for the video's sound"}</span>
        <span className="xl:hidden">Original</span>
      </button>
      <LevelBar player={player} />
      <span className="ml-auto flex min-w-0 shrink items-center gap-2">
        <RenderBadge render={render} />
        {props.exportMenu}
      </span>
    </div>
  );
}

/** Output level of what is playing (RMS of the analyser, −48 to 0 dBFS), drawn without re-rendering React. */
function LevelBar({ player }: { player: Player }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (bar.current) bar.current.style.transform = `scaleX(${player.level()})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player]);
  return (
    <span className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted max-sm:hidden" title="Output level (−48 to 0 dBFS)" aria-hidden>
      <span ref={bar} className="absolute inset-0 origin-left scale-x-0 rounded-full bg-foreground" />
    </span>
  );
}

function RenderBadge({ render }: { render: RenderState }) {
  if (render.status === "rendering")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
        <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> <span className="max-sm:hidden">Rendering</span>
      </span>
    );
  if (render.status === "error")
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-danger" title={render.error} aria-live="polite">
        <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.5} /> <span className="truncate max-sm:hidden">Render failed</span>
      </span>
    );
  if (render.status === "ready" && render.ms)
    return <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground max-sm:hidden" title="How long the server took to render the mix">{render.ms.toLocaleString("en")} ms</span>;
  return null;
}

/**
 * The measurements of the current render: sample peak and full-scale samples (measured in the browser on
 * what you hear) and the integrated loudness and true peak (measured by ffmpeg on the server).
 */
export function MixMeter(props: { player: Player; analysis: Analysis | null; stale: boolean; loudness: number | null; render: RenderState }) {
  const { player, analysis } = props;
  const peak = player.peak("processed");
  if (props.render.status === "error")
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-muted/70 px-3 py-2 text-xs text-danger" role="alert">
        <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.5} /> {props.render.error}
      </p>
    );
  if (!peak) return null;
  const clipped = peak.clipped;
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-muted/70 px-3 py-1.5 text-xs transition-opacity", props.stale && "opacity-50")} data-mix-meter>
      <span title="Integrated loudness of the render, measured by ffmpeg (EBU R128)">
        <span className="text-muted-foreground">Loudness</span>{" "}
        <span className="font-mono tabular-nums" data-lufs={analysis?.integratedLufs ?? ""}>
          {analysis?.integratedLufs != null ? `${analysis.integratedLufs.toFixed(1)} LUFS` : "…"}
        </span>
        {props.loudness !== null && <span className="text-muted-foreground"> · target {props.loudness}</span>}
      </span>
      <span title="True peak of the render, measured by ffmpeg">
        <span className="text-muted-foreground">True peak</span> <span className="font-mono tabular-nums">{analysis?.truePeakDb != null ? `${analysis.truePeakDb.toFixed(1)} dBTP` : "…"}</span>
      </span>
      <span title="Sample peak of what you hear, measured in your browser">
        <span className="text-muted-foreground">Peak</span>{" "}
        <span className="font-mono tabular-nums">
          {peak.db <= -100 ? "−∞" : `${peak.db > 0 ? "+" : ""}${peak.db.toFixed(1)}`} dBFS
        </span>
      </span>
      <span title="Samples at full scale in the render">
        <span className="text-muted-foreground">Clipping</span>{" "}
        <span className={cn("font-mono tabular-nums", clipped > 8 && "text-danger")}>{clipped > 8 ? `${clipped.toLocaleString("en")} samples` : "none"}</span>
      </span>
      <span className="text-muted-foreground max-sm:hidden">{props.stale ? "Measuring…" : "Measured on the render"}</span>
    </div>
  );
}

/** Mix (WAV), the video with this audio, and the project file for `sfx mix`. */
export function ExportMenu(props: { hasContent: boolean; videoName: string | null; busy: ExportKind | null; onExport: (kind: ExportKind) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const run = (kind: ExportKind) => {
    setAnchor(null);
    props.onExport(kind);
  };
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-expanded={!!anchor}
        disabled={!props.hasContent && !props.videoName}
        title="Export the mix"
      >
        {props.busy ? <LoaderCircle className="animate-spin" strokeWidth={1.5} /> : <Download strokeWidth={1.5} />}
        <span className="max-sm:hidden">{props.busy ? "Exporting" : "Export"}</span>
      </Button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Export" width={320}>
        <MenuRow icon={<FileAudio strokeWidth={1.5} />} title="Mix (WAV)" sub="24-bit, 48 kHz, the full length" disabled={!!props.busy || !props.hasContent} onClick={() => run("wav")} />
        <MenuRow
          icon={<Clapperboard strokeWidth={1.5} />}
          title="Video with this audio"
          sub={props.videoName ? `The picture of ${props.videoName}, untouched, with the mix as its sound` : "Load a video first"}
          disabled={!!props.busy || !props.videoName}
          onClick={() => run("video")}
        />
        <MenuRow icon={<Braces strokeWidth={1.5} />} title="Project (JSON)" sub="For sfx mix on the command line" disabled={!props.hasContent} onClick={() => run("json")} />
      </Popover>
    </>
  );
}
