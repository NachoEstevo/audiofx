import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compile, decodeFloat32, runFfmpeg, type CompileOptions, type EffectStep } from "../src/core/index.js";

export const RATE = 48000;

export function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "audiofx-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Makes a stereo WAV from a lavfi graph (sine, anoisesrc...). */
export async function makeSignal(dir: string, name: string, lavfi: string): Promise<string> {
  const file = path.join(dir, `${name}.wav`);
  await runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", lavfi, "-ac", "2", "-ar", String(RATE), "-c:a", "pcm_f32le", file]);
  return file;
}

export const sine = (dir: string, freq: number, secs = 2, amp = 0.25) =>
  makeSignal(dir, `sine-${freq}-${secs}`, `sine=f=${freq}:d=${secs}:r=${RATE},volume=${amp}`);

export async function render(input: string, steps: EffectStep[], options: CompileOptions = {}) {
  return decodeFloat32(input, compile(steps, options).graph);
}

/** RMS in dB of the [from, to) stretch, in seconds, of an interleaved stereo signal. */
export function rmsDb(x: Float32Array, from = 0, to = Infinity): number {
  const a = Math.max(0, Math.floor(from * RATE) * 2);
  const b = Math.min(x.length, Math.floor(Math.min(to, x.length / 2 / RATE) * RATE) * 2);
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i] * x[i];
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-20);
}

export const seconds = (x: Float32Array) => x.length / 2 / RATE;

/** Counts NaN/Inf or absurdly large samples (memory garbage). */
export function nonFinite(x: Float32Array): number {
  let bad = 0;
  for (const v of x) if (!Number.isFinite(v) || Math.abs(v) > 16) bad++;
  return bad;
}
