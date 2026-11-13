import { Download, LoaderCircle, Pause, Play, Repeat, Scale } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Player } from "../player";
import { bars, formatTime, usePlayerTime } from "../visuals";
import { Button } from "@/components/ui/button";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { AudioScrubber } from "@/components/ui/waveform";
import { cn } from "@/lib/utils";

export type RenderState = { status: "idle" | "rendering" | "ready" | "error"; ms?: number; error?: string };

const BAR_COUNT = 300;

/**
 * The stage: an orb that breathes with the audio, what you are hearing, the waveform with the marked
 * moment, and the transport. Everything needed to try a sound without looking away.
 */
export function Stage(props: {
  player: Player;
  color: string;
  listening: string;
  listeningHint: string;
  sourcePicker: ReactNode;
  moment: number;
  onMoment: (t: number) => void;
  timed: boolean;
  render: RenderState;
  regions: { from: number; to: number; label?: string }[];
  downloadUrl: string | null;
  onHoldOriginal: (on: boolean) => void;
  onAddLimiter: () => void;
}) {
  const { player, render } = props;
  const time = usePlayerTime(player);
  const shown = player.buffer();
  const span = Math.max(player.peek("original")?.duration ?? 0, player.peek("processed")?.duration ?? 0) || 1;
  const data = useMemo(() => {
    const raw = bars(shown, span, BAR_COUNT);
    const peak = Math.max(0.05, ...raw);
    return raw.map((v) => v / peak);
  }, [shown, span]);
  const busy = render.status === "rendering";

  return (
    <section className="rounded-[28px] bg-card p-5 shadow-card sm:p-7" aria-label="Stage">
      {/* In a narrow column (desktop side panel) the orb sits on top; on tablet, to the side. */}
      <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 lg:grid-cols-1 lg:gap-5">
        <button
          className="group relative mx-auto block size-[132px] cursor-pointer rounded-full sm:size-[168px] lg:size-[184px]"
          onClick={() => player.toggle()}
          aria-label={player.playing ? "Pause (space)" : "Play (space)"}
        >
          <FluidOrb size={184} color={props.color} getLevel={() => player.level()} className="size-full! transition-transform duration-300 ease-out group-active:scale-[0.97]" />
          <span
            className={cn(
              "absolute inset-0 m-auto grid size-12 place-items-center rounded-full bg-white/85 text-foreground shadow-ring backdrop-blur transition-[opacity,scale] duration-200 ease-out",
              player.playing ? "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100" : "opacity-100",
            )}
          >
            {busy ? (
              <LoaderCircle className="size-5 animate-spin" strokeWidth={1.75} />
            ) : player.playing ? (
              <Pause className="size-5" fill="currentColor" strokeWidth={0} />
            ) : (
              <Play className="size-5 translate-x-px" fill="currentColor" strokeWidth={0} />
            )}
          </span>
        </button>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">{props.sourcePicker}</div>
          <div key={props.listening} className="animate-rise mt-4">
            <p className="text-xs text-muted-foreground">{player.track === "original" ? "Hearing the original" : "Hearing"}</p>
            <h2 className="mt-0.5 truncate font-display text-[28px] leading-tight font-light tracking-[-0.03em] text-balance sm:text-[34px]">
              {player.track === "original" ? "No effects" : props.listening}
            </h2>
            <p className="truncate text-[13px] text-muted-foreground">{props.listeningHint}</p>
          </div>

          <div className="relative mt-7">
            <AudioScrubber
              data={data}
              currentTime={time}
              duration={span}
              onSeek={(t) => {
                props.onMoment(t);
                player.seek(t);
              }}
              height={64}
              barWidth={2}
              barGap={1}
              barRadius={1}
              barColor="var(--wave)"
              progressColor="var(--foreground)"
              regions={props.regions}
              className={cn("transition-opacity duration-200", busy && "opacity-50")}
            />
            <MomentFlag t={props.moment} span={span} active={props.timed} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {props.timed ? "Tap the waveform to move the moment: the hit lands there." : "Tap the waveform to jump there."}
            {render.status === "error" && <span className="ml-2 text-danger">{render.error}</span>}
          </p>
          <OutputMeter player={player} onAddLimiter={props.onAddLimiter} />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
              <span className="text-foreground">{formatTime(time)}</span> / {formatTime(span)}
            </span>
            <button
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-[13px] whitespace-nowrap shadow-ring transition-colors select-none",
                player.track === "original" ? "bg-foreground text-white" : "bg-card hover:bg-muted",
              )}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                props.onHoldOriginal(true);
              }}
              onPointerUp={() => props.onHoldOriginal(false)}
              onPointerCancel={() => props.onHoldOriginal(false)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !e.repeat && props.onHoldOriginal(true)}
              onKeyUp={(e) => (e.key === "Enter" || e.key === " ") && props.onHoldOriginal(false)}
              title="Hold (or the A key) to compare with the original"
            >
              <kbd className="font-mono text-[11px]">A</kbd> Hold for original
            </button>
            <Button
              size="icon"
              variant={player.matchLoudness ? "primary" : "ghost"}
              onClick={() => player.setMatchLoudness(!player.matchLoudness)}
              aria-pressed={player.matchLoudness}
              aria-label="Match loudness (M)"
              title="Match loudness (M): compare the character, not the level"
            >
              <Scale strokeWidth={1.5} />
            </Button>
            <Button
              size="icon"
              variant={player.loop ? "primary" : "ghost"}
              onClick={() => player.setLoop(!player.loop)}
              aria-pressed={player.loop}
              aria-label="Loop"
              title="Loop"
            >
              <Repeat strokeWidth={1.5} />
            </Button>
            {props.downloadUrl && (
              <a
                href={props.downloadUrl}
                download="audiofx.wav"
                className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-card px-3.5 text-[13px] shadow-ring transition-colors hover:bg-muted"
              >
                <Download className="size-4" strokeWidth={1.5} /> WAV
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * What an engineer checks after every insert: how much the chain moved the level (M compensates it while
 * listening, the export does not) and whether the render reaches full scale.
 */
function OutputMeter({ player, onAddLimiter }: { player: Player; onAddLimiter: () => void }) {
  const processed = player.peak("processed");
  const diff = player.levelDiffDb;
  if (!processed || diff === null) return null;
  const peak = processed.db;
  // A few full-scale samples happen in loud masters; a run of them, more than the original had, is clipping.
  const over = processed.clipped > Math.max(8, (player.peak("original")?.clipped ?? 0) * 1.5);
  return (
    <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-muted/70 px-3 py-1.5 text-xs">
      <span title="Level of the processed render against the original (RMS of the non-silent parts). M matches them while you listen; the export keeps the difference.">
        <span className="text-muted-foreground">Level</span>{" "}
        <span className={cn("font-mono tabular-nums", Math.abs(diff) > 6 && "text-[var(--moment)]")}>
          {diff >= 0 ? "+" : "−"}
          {Math.abs(diff).toFixed(1)} dB
        </span>
      </span>
      <span title="Sample peak of the processed render. Leave about 1 dB of headroom for delivery.">
        <span className="text-muted-foreground">Peak</span>{" "}
        <span className={cn("font-mono tabular-nums", over && "text-danger")}>
          {peak <= -100 ? "−∞" : `${peak > 0 ? "+" : ""}${peak.toFixed(1)}`} dBFS
        </span>
      </span>
      {over && (
        <button onClick={onAddLimiter} className="ml-auto inline-flex h-7 cursor-pointer items-center rounded-full bg-foreground px-3 text-white hover:bg-foreground/85">
          Clipping · add a limiter
        </button>
      )}
    </div>
  );
}

function MomentFlag({ t, span, active }: { t: number; span: number; active: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-2 bottom-0 w-px transition-[left,opacity] duration-200 ease-out",
        active ? "bg-[var(--moment)] opacity-100" : "bg-foreground/30 opacity-60",
      )}
      style={{ left: `${(t / span) * 100}%` }}
    >
      <span
        className={cn(
          "absolute -top-4 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px font-mono text-[10px] whitespace-nowrap tabular-nums",
          active ? "bg-[var(--moment)] text-white" : "bg-muted text-muted-foreground",
        )}
      >
        {formatTime(t)}
      </span>
    </div>
  );
}
