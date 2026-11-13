import { TriangleAlert } from "lucide-react";
import { FRAME_24 } from "../measure";
import { cn } from "@/lib/utils";

export interface Facts {
  /** Processed − original, RMS of the non-silent parts. */
  levelDb: number;
  peakDb: number;
  clips: boolean;
  /** Samples at full scale in the render. */
  clipped: number;
  durationChange: number;
  /** Seconds of silence the compiler pads at the end for tails (part of the duration change). */
  tailPad: number;
  renderMs: number;
  cached: boolean;
  /** Processed − original onset in seconds; null when it is not measured, with the reason. */
  onsetShift: number | null;
  onsetSkipped: string | null;
}

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
const FRAME_MS = (FRAME_24 * 1000).toFixed(1);

/**
 * What the render measures against the original. Numbers only: the screen never says how an effect
 * sounds; that is the listener's verdict.
 */
export function Measurements({ facts, stale }: { facts: Facts | null; stale: boolean }) {
  return (
    <section aria-labelledby="review-measurements" className="rounded-3xl bg-card p-5 shadow-ring">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="review-measurements" className="font-display text-lg tracking-[-0.02em]">
          Measurements
        </h3>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {!facts ? "Waiting for the render…" : stale ? "Updating…" : "Of the current render"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-pretty text-muted-foreground">Measured in your browser against the original. They describe the signal, not how it sounds.</p>
      {facts && (
        <dl className={cn("mt-4 grid grid-cols-2 gap-x-6 gap-y-4 transition-opacity sm:grid-cols-3", stale && "opacity-45")}>
          <Fact label="Level change" value={`${signed(facts.levelDb, 1)} dB`} note="RMS of the non-silent parts" />
          <Fact
            label="Peak"
            value={`${facts.peakDb <= -100 ? "−∞" : signed(facts.peakDb, 1)} dBFS`}
            note={facts.clips ? `Clips: ${facts.clipped.toLocaleString("en")} samples at full scale` : "Clips: no"}
            flag={facts.clips}
          />
          <Fact
            label="Duration change"
            value={`${signed(facts.durationChange, 2)} s`}
            note={facts.tailPad > 0 ? `Includes ${facts.tailPad.toFixed(1)} s of silence padded for the tail` : null}
          />
          <Fact label="Render time" value={`${Math.round(facts.renderMs).toLocaleString("en")} ms`} note={facts.cached ? "Measured when it was first rendered" : null} />
          {facts.onsetShift === null ? (
            <Fact label="Onset shift" value="—" note={facts.onsetSkipped} />
          ) : (
            <Fact
              label="Onset shift"
              value={`${signed(facts.onsetShift * 1000, 0)} ms`}
              note={Math.abs(facts.onsetShift) > FRAME_24 ? `More than one frame at 24 fps (${FRAME_MS} ms)` : `Within one frame at 24 fps (${FRAME_MS} ms)`}
              flag={Math.abs(facts.onsetShift) > FRAME_24}
            />
          )}
        </dl>
      )}
    </section>
  );
}

function Fact({ label, value, note, flag }: { label: string; value: string; note?: string | null; flag?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] tabular-nums">{value}</dd>
      {note && (
        <dd className={cn("mt-0.5 flex items-start gap-1 text-xs leading-snug text-pretty", flag ? "text-danger" : "text-muted-foreground")}>
          {flag && <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />}
          {note}
        </dd>
      )}
    </div>
  );
}
