/**
 * Small fluid orbs for the sound tiles, with the Rare UI Fluid Orb shader (see fluid-orb.tsx for the
 * license and credit). Browsers cap WebGL contexts at ~16 per page, so a single hidden context renders
 * every swatch and copies the frame into each tile's 2D canvas. Idle swatches are painted once (each with
 * its own phase, so no two look alike); only hovered, playing or rendering ones animate, and only while
 * they are on screen.
 */
import { useEffect, useRef } from "react";
import { createOrbRenderer, hexToRgb, type OrbRenderer } from "@/components/ui/fluid-orb";
import { cn } from "@/lib/utils";

export type SwatchMode = "idle" | "hover" | "playing" | "busy";

interface Entry {
  ctx: CanvasRenderingContext2D;
  px: number;
  color: [number, number, number];
  phase: number;
  level: number;
  mode: SwatchMode;
  getLevel?: () => number;
  visible: boolean;
  dirty: boolean;
}

const MAX_PX = 128;
const SPEED: Record<SwatchMode, number> = { idle: 0, hover: 0.55, playing: 0.3, busy: 1.4 };

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let orb: OrbRenderer | null = null;
let failed = false;
let raf = 0;
let last = 0;
const entries = new Set<Entry>();
const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function renderer(): OrbRenderer | null {
  if (orb || failed) return orb;
  glCanvas = document.createElement("canvas");
  glCanvas.width = MAX_PX;
  glCanvas.height = MAX_PX;
  gl = glCanvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  orb = gl ? createOrbRenderer(gl) : null;
  failed = !orb;
  return orb;
}

function paint(e: Entry, r: OrbRenderer) {
  r.draw(e.px, e.phase, e.level, e.color);
  e.ctx.clearRect(0, 0, e.px, e.px);
  // WebGL's viewport sits at the bottom-left; in image coordinates that is the last px rows.
  e.ctx.drawImage(glCanvas!, 0, MAX_PX - e.px, e.px, e.px, 0, 0, e.px, e.px);
  e.dirty = false;
}

function tick(now: number) {
  raf = 0;
  const r = renderer();
  if (!r) return;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  let again = false;
  for (const e of entries) {
    if (!e.visible) continue;
    const moving = e.mode !== "idle" && !reduce;
    if (moving) {
      const target = e.mode === "playing" ? Math.min(1, Math.max(0, e.getLevel?.() ?? 0)) : e.mode === "busy" ? 0.4 : 0.15;
      e.level += (target - e.level) * (target > e.level ? 0.35 : 0.06);
      e.phase += dt * (SPEED[e.mode] + e.level * 1.2);
      again = true;
    } else if (e.level > 0.01) {
      // Settle back to rest instead of freezing mid-swell.
      e.level *= 0.9;
      e.dirty = true;
      again = true;
    }
    if (moving || e.dirty) paint(e, r);
  }
  if (again) schedule();
  else last = 0;
}

function schedule() {
  if (!raf && !failed) raf = requestAnimationFrame(tick);
}

/** Stable per-sound phase so idle swatches are frozen at different moments of the flow. */
function seedPhase(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 100;
}

export function OrbSwatch(props: { color: string; seed: string; size?: number; mode?: SwatchMode; getLevel?: () => number; className?: string }) {
  const { size = 36, mode = "idle" } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entryRef = useRef<Entry | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const px = Math.min(MAX_PX, Math.round(size * Math.min(window.devicePixelRatio || 1, 2)));
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const entry: Entry = { ctx, px, color: hexToRgb(props.color), phase: seedPhase(props.seed), level: 0, mode, getLevel: props.getLevel, visible: false, dirty: true };
    entryRef.current = entry;
    entries.add(entry);
    const io = new IntersectionObserver(([hit]) => {
      entry.visible = hit.isIntersecting;
      if (entry.visible) schedule();
    });
    io.observe(canvas);
    return () => {
      io.disconnect();
      entries.delete(entry);
      entryRef.current = null;
    };
    // The entry is created once per canvas; color and mode updates go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, props.seed]);

  useEffect(() => {
    const e = entryRef.current;
    if (!e) return;
    e.color = hexToRgb(props.color);
    e.mode = mode;
    e.getLevel = props.getLevel;
    e.dirty = true;
    schedule();
  }, [props.color, mode, props.getLevel]);

  return (
    <span
      className={cn("orb-swatch", mode === "playing" && "is-playing", mode === "busy" && "is-busy", props.className)}
      style={{ "--c": props.color, width: size, height: size } as React.CSSProperties}
    >
      <canvas ref={canvasRef} className="size-full rounded-full" aria-hidden />
    </span>
  );
}
