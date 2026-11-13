import { useEffect, useState } from "react";
import type { Player } from "./player";

/** Absolute peaks per bar across `span` seconds (0 where the buffer has ended). */
export function bars(buffer: AudioBuffer | undefined, span: number, count: number): number[] {
  const out = new Array<number>(count).fill(0);
  if (!buffer || span <= 0) return out;
  const l = buffer.getChannelData(0);
  const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  const perBar = (span * buffer.sampleRate) / count;
  for (let b = 0; b < count; b++) {
    const start = Math.floor(b * perBar);
    if (start >= l.length) break;
    const end = Math.min(l.length, Math.floor((b + 1) * perBar));
    let peak = 0;
    for (let i = start; i < end; i += 3) {
      const v = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

/** Playback time per frame; only re-renders the component that uses it. */
export function usePlayerTime(player: Player) {
  const [t, setT] = useState(player.time);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = player.time;
      setT((prev) => (Math.abs(prev - now) > 0.008 ? now : prev));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player]);
  return t;
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
