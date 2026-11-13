import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeFile, measureSections, runFfmpeg, trackSections, type TrackSections } from "../src/core/index.js";
import { makeSignal, tempDir } from "./helpers.js";

const tmp = tempDir();
afterAll(() => tmp.cleanup());

/** A quiet pad (two sines) all along. */
const PAD = "0.03*sin(2*PI*220*t)+0.03*sin(2*PI*277.2*t)";
/** A beat from second `from`: a decaying 55 Hz kick every `beat` s and a white-noise hat on the off-beats. */
const beat = (from: number, beat = 0.5, kick = 0.7) =>
  `gte(t,${from})*(${kick}*sin(2*PI*55*mod(t-${from},${beat}))*exp(-18*mod(t-${from},${beat}))+0.08*(2*random(0)-1)*exp(-60*mod(t-${from},${beat / 2})))`;
/** A synth chord (440, 660, 1320 Hz). */
const CHORD = "(sin(2*PI*440*t)+0.5*sin(2*PI*660*t)+0.3*sin(2*PI*1320*t))";
const signal = (name: string, expr: string, seconds: number) => makeSignal(tmp.dir, name, `aevalsrc='${expr}':s=48000:d=${seconds}`);

let drop: string;
let twoRises: string;
let buildUp: string;
let loudBuildUp: string;
let cutOff: string;
let noise: string;
let loop: string;

/** A 4 s white-noise riser up to 8 s at `riser` amplitude, 0.3 s of gap, and the drop (beat, bass, chord) at 8.3 s. */
const buildUpTo = (riser: number) =>
  `${PAD}+between(t,4,8)*${riser}*((t-4)/4)*(2*random(0)-1)+${beat(8.3, 0.5, 0.8)}+gte(t,8.3)*(0.25*sin(2*PI*55*t)+0.1*${CHORD})`;

beforeAll(async () => {
  [drop, twoRises, buildUp, loudBuildUp, cutOff, noise, loop] = await Promise.all([
    // Pad alone for 8 s, then the beat enters at 8.0 s.
    signal("drop", `${PAD}+${beat(8)}`, 16),
    // Loud from 5 to 10 s, medium from 15 to 20 s: a big rise first, a fall, a smaller rise.
    signal("two-rises", `${PAD}+(0.25*between(t,5,10)+0.08*between(t,15,20))*${CHORD}`, 20),
    // The riser ends a few dB under the drop; in a heavily limited master it ends as loud as the drop.
    signal("build-up", buildUpTo(0.12), 16),
    signal("loud-build-up", buildUpTo(0.3), 16),
    // The chord stops dead at 8.0 s and a short low tick (a sharp attack) lands 0.15 s later, in the quiet part.
    signal("cut-off", `${PAD}+between(t,2,8)*0.25*${CHORD}+gte(t,8.15)*0.15*sin(2*PI*100*(t-8.15))*exp(-30*(t-8.15))`, 14),
    makeSignal(tmp.dir, "noise", "anoisesrc=d=12:c=pink:a=0.3:r=48000:seed=4"),
    // A steady loop at 128 bpm: the windows never hold a whole number of beats.
    signal("loop", `${PAD}+${beat(0, 0.46875)}`, 12),
  ]);
});

const times = (changes: TrackSections["rises"]) => changes.map((c) => c.time);

/** Integrated loudness of the stretch [from, to) of a file, measured by ffmpeg's ebur128 on its own. */
async function lufsOf(file: string, from: number, to: number): Promise<number> {
  const part = path.join(tmp.dir, `${path.basename(file, ".wav")}-${from}-${to}.wav`);
  await runFfmpeg(["-y", "-v", "error", "-ss", String(from), "-t", String(to - from), "-i", file, "-c:a", "pcm_f32le", part]);
  return (await analyzeFile(part)).integratedLufs!;
}

describe("sections", () => {
  it("finds the drop where the beat enters, on its first kick, with the size of the jump", async () => {
    const result = await measureSections(drop);
    const [first] = result.rises;
    expect(first.time).toBeGreaterThan(7.95);
    expect(first.time).toBeLessThan(8.05);
    expect(first.sharp).toBe(true);
    const trueJump = (await lufsOf(drop, 8, 11)) - (await lufsOf(drop, 5, 8));
    expect(Math.abs(first.jump - trueJump)).toBeLessThan(2);
    // The kick lives below 150 Hz: the low band jumps much more than the whole.
    expect(first.lowJump).toBeGreaterThan(first.jump + 10);
    expect(result.duration).toBeCloseTo(16, 2);
    expect(result.integrated).toBeCloseTo((await analyzeFile(drop)).integratedLufs!, 1);
  });

  it("ranks the bigger rise first, finds the fall and the loudest and quietest sections", async () => {
    const result = await measureSections(twoRises);
    expect(times(result.rises)).toHaveLength(2);
    expect(result.rises[0].time).toBeCloseTo(5, 1);
    expect(result.rises[1].time).toBeCloseTo(15, 1);
    expect(result.rises[0].jump).toBeGreaterThan(result.rises[1].jump);
    expect(times(result.falls)).toHaveLength(1);
    // A fall lands on the first quiet 5 ms block: up to one block after the cut.
    expect(result.falls[0].time).toBeGreaterThanOrEqual(10);
    expect(result.falls[0].time).toBeLessThanOrEqual(10.01);
    expect(result.falls[0].jump).toBeLessThan(-10);
    const edges = result.sections.map((s) => [s.start, Math.round(s.end)]);
    expect(edges).toEqual([
      [0, 5],
      [5, 10],
      [result.falls[0].time, 15],
      [15, 20],
    ]);
    expect(result.loudest).toMatchObject({ start: 5 });
    expect(result.quietest).toMatchObject({ start: 0, end: 5 });
  });

  it("puts a fall on the cut-off, not on an attack right after it", async () => {
    const result = await measureSections(cutOff);
    expect(result.falls).toHaveLength(1);
    expect(result.falls[0].time).toBeGreaterThan(7.98);
    expect(result.falls[0].time).toBeLessThan(8.02);
    expect(result.falls[0].sharp).toBe(true);
  });

  it("finds a drop after a build-up and a gap, on its first kick, even when the riser is as loud as the drop", async () => {
    for (const file of [buildUp, loudBuildUp]) {
      const result = await measureSections(file);
      // With a loud riser, the 3 s after a point in the riser already hold the drop's bass: without the
      // 1 s check on the low band, build-up and drop merge into one rise in the middle of the riser.
      const [first] = result.rises;
      expect(first.time, path.basename(file)).toBeGreaterThan(8.25);
      expect(first.time, path.basename(file)).toBeLessThan(8.35);
      expect(first.sharp).toBe(true);
      expect(first.lowJump).toBeGreaterThan(20);
    }
  });

  it("reports no changes on a flat signal or a steady loop", async () => {
    for (const file of [noise, loop]) {
      const result = await measureSections(file);
      expect(result.rises, path.basename(file)).toEqual([]);
      expect(result.falls, path.basename(file)).toEqual([]);
      expect(result.sections).toHaveLength(1);
    }
  });

  it("handles silence and short signals, and keeps `top` changes", () => {
    const silent = trackSections(new Float32Array(48000 * 5), 48000);
    expect(silent).toMatchObject({ duration: 5, integrated: null, rises: [], falls: [], sections: [], quietest: null, loudest: null });
    expect(trackSections(new Float32Array(100), 48000).rises).toEqual([]);
    expect(() => trackSections(new Float32Array(100), 48000, { top: 0 })).toThrow(/top/);
  });
});
