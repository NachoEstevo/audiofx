import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EffectStep } from "../src/core/index.js";
import { RATE, makeSignal, nonFinite, render, rmsDb, seconds, tempDir } from "./helpers.js";

/** Editor tools measured on synthetic fixtures: noise reduction, sibilance and a pass-by. */

const tmp = tempDir();
afterAll(() => tmp.cleanup());

const dry = (input: string) => render(input, [{ effect: "gain", params: { db: 0 } }], { tail: 0 });
const wet = (input: string, steps: EffectStep[]) => render(input, steps, { tail: 0 });

/** Mean level (dB) of an interleaved stereo signal over several [from, to) stretches. */
function levelIn(x: Float32Array, windows: [number, number][]): number {
  let sum = 0;
  let count = 0;
  for (const [from, to] of windows) {
    for (let i = Math.floor(from * RATE) * 2; i < Math.floor(to * RATE) * 2 && i < x.length; i++) {
      sum += x[i] * x[i];
      count++;
    }
  }
  return 10 * Math.log10(sum / Math.max(1, count) + 1e-20);
}

/** Level (dB) of one channel over [from, to). */
function channelDb(x: Float32Array, ch: 0 | 1, from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = Math.floor(from * RATE); i < Math.floor(to * RATE); i++) {
    sum += x[2 * i + ch] ** 2;
    count++;
  }
  return 10 * Math.log10(sum / count + 1e-20);
}

/** Frequency of the mono sum over [from, to), counting interpolated rising zero crossings. */
function zeroCrossingHz(x: Float32Array, from: number, to: number): number {
  const at = (i: number) => x[2 * i] + x[2 * i + 1];
  const crossings: number[] = [];
  for (let i = Math.floor(from * RATE) + 1; i < Math.floor(to * RATE); i++) {
    const a = at(i - 1);
    const b = at(i);
    if (a < 0 && b >= 0) crossings.push(i - 1 + a / (a - b));
  }
  return ((crossings.length - 1) * RATE) / (crossings[crossings.length - 1] - crossings[0]);
}

/** First sample whose magnitude exceeds `threshold`. */
const firstAbove = (x: Float32Array, threshold: number) => Math.floor(x.findIndex((v) => Math.abs(v) > threshold) / 2);

describe("denoise", () => {
  let toneInNoise: string;
  beforeAll(async () => {
    // White noise around -61 dBFS for 4 s (a quiet home recording) and a 1 kHz tone from 1.5 s to 3 s.
    toneInNoise = await makeSignal(
      tmp.dir,
      "tone-in-noise",
      "sine=f=1000:d=1.5:r=48000,volume=0.8,adelay=delays=1500:all=1,apad=pad_dur=1[t];" +
        "anoisesrc=d=4:c=white:a=0.003:r=48000:seed=3[nz];[t][nz]amix=inputs=2:normalize=0:duration=longest",
    );
  });

  it("lowers the noise between phrases and keeps the tone, in sync and with the same length", async () => {
    const before = await dry(toneInNoise);
    const after = await wet(toneInNoise, [{ effect: "denoise" }]);
    // Measured: the noise-only stretch drops 12.0 dB with the defaults and the tone changes by 0.00 dB.
    expect(rmsDb(before, 0.3, 1.3) - rmsDb(after, 0.3, 1.3)).toBeGreaterThan(9);
    expect(Math.abs(rmsDb(after, 1.7, 2.8) - rmsDb(before, 1.7, 2.8))).toBeLessThan(1.5);
    // afftdn delays its output by 25 ms; the effect compensates it to the sample.
    expect(Math.abs(firstAbove(after, 0.035) - firstAbove(before, 0.035))).toBeLessThanOrEqual(2);
    expect(after.length).toBe(before.length);
  });

  it("the room profile removes more of a noise with more lows than the hiss profile", async () => {
    // Measured on pink noise at -51.5 dBFS: hiss -2.6 dB, mixed -4.8 dB, room -6.9 dB.
    const pink = await makeSignal(tmp.dir, "pink-floor", "anoisesrc=d=3:c=pink:a=0.02:r=48000:seed=5");
    const reduction = async (noise: string) =>
      rmsDb(await dry(pink), 0.5, 2.5) - rmsDb(await wet(pink, [{ effect: "denoise", params: { noise } }]), 0.5, 2.5);
    expect((await reduction("room")) - (await reduction("hiss"))).toBeGreaterThan(2);
  });
});

describe("de-esser", () => {
  let sibilance: string;
  // A 200 Hz tone and 120 ms bursts of 5–9 kHz noise every 0.5 s from 0.5 s (-34 dB above 4.5 kHz, like loud esses).
  const bursts: [number, number][] = [0, 1, 2, 3, 4].map((k) => [0.51 + k * 0.5, 0.61 + k * 0.5]);
  const gaps: [number, number][] = [0, 1, 2, 3, 4].map((k) => [0.7 + k * 0.5, 0.95 + k * 0.5]);
  const highBand = { effect: "highpass", params: { freq: 4500, slope: "48" } };
  const lowBand = { effect: "lowpass", params: { freq: 1000, slope: "48" } };

  beforeAll(async () => {
    sibilance = await makeSignal(
      tmp.dir,
      "sibilance",
      "sine=f=200:d=3:r=48000,volume=4[t];" +
        "anoisesrc=d=3:c=white:a=0.25:r=48000:seed=4,highpass=f=5000,highpass=f=5000,lowpass=f=9000,lowpass=f=9000," +
        "aeval='val(0)*gte(t,0.5)*clip(min(mod(t-0.5,0.5),0.12-mod(t-0.5,0.5))/0.01,0,1)':c=same[s];" +
        "[t][s]amix=inputs=2:normalize=0",
    );
  });

  const reduction = async (params: Record<string, number>) =>
    levelIn(await wet(sibilance, [{ effect: "gain", params: { db: 0 } }, highBand]), bursts) -
    levelIn(await wet(sibilance, [{ effect: "de-esser", params }, highBand]), bursts);

  it("turns down high-band bursts and leaves the low tone alone", async () => {
    // Measured: the bursts drop 6.0 dB with the defaults; the tone moves 0.06 dB during them and 0.00 between.
    expect(await reduction({})).toBeGreaterThan(3);
    const lowDry = await wet(sibilance, [{ effect: "gain", params: { db: 0 } }, lowBand]);
    const lowWet = await wet(sibilance, [{ effect: "de-esser" }, lowBand]);
    expect(Math.abs(levelIn(lowWet, bursts) - levelIn(lowDry, bursts))).toBeLessThan(0.5);
    expect(Math.abs(levelIn(lowWet, gaps) - levelIn(lowDry, gaps))).toBeLessThan(0.1);
  });

  it("acts harder when it starts lower in frequency", async () => {
    // Measured: -8.9 dB at 2 kHz, -4.5 dB at 6 kHz.
    expect((await reduction({ freq: 2000 })) - (await reduction({ freq: 6000 }))).toBeGreaterThan(2);
  });
});

describe("doppler", () => {
  const SPEED_OF_SOUND = 343;
  const at = 3;
  const speed = 90 / 3.6;
  const distance = 10;
  /** The physical ratio c / (c − v·cosθ), averaged over [from, to). */
  const expectedRatio = (from: number, to: number) => {
    let sum = 0;
    let count = 0;
    for (let t = from; t < to; t += 0.001) {
      const x = speed * (t - at);
      sum += SPEED_OF_SOUND / (SPEED_OF_SOUND + (speed * x) / Math.hypot(distance, x));
      count++;
    }
    return sum / count;
  };
  let tone: string;
  let pass: Float32Array;
  beforeAll(async () => {
    tone = await makeSignal(tmp.dir, "tone-6s", "sine=f=1000:d=6:r=48000,volume=4");
    pass = await wet(tone, [{ effect: "doppler", params: { at, speed: 90, distance } }]);
  });

  it("sounds higher before the pass and lower after it, as the physical curve says", async () => {
    const before = zeroCrossingHz(pass, at - 1.5, at - 0.5) / 1000;
    const after = zeroCrossingHz(pass, at + 0.5, at + 1.5) / 1000;
    // Measured: 1.0728 before and 0.9375 after against 1.0712 and 0.9377 (90 km/h, 10 m); the glide crosses 5 ms after `at`.
    expect(Math.abs(before / expectedRatio(at - 1.5, at - 0.5) - 1)).toBeLessThan(0.01);
    expect(Math.abs(after / expectedRatio(at + 0.5, at + 1.5) - 1)).toBeLessThan(0.01);
    // The glide crosses the original pitch at `at`, within one frame at 24 fps.
    let crossing = NaN;
    for (let t = at - 0.3; t < at + 0.3; t += 0.005) {
      if (zeroCrossingHz(pass, t - 0.025, t + 0.025) < 1000) {
        crossing = t;
        break;
      }
    }
    expect(Math.abs(crossing - at)).toBeLessThan(1 / 24);
  });

  it("peaks in level at the pass and moves from the left channel to the right", async () => {
    let peak = -Infinity;
    let peakAt = 0;
    for (let t = 0.3; t < 5.7; t += 0.01) {
      const level = rmsDb(pass, t, t + 0.02);
      if (level > peak) [peak, peakAt] = [level, t + 0.01];
    }
    expect(Math.abs(peakAt - at)).toBeLessThan(0.1);
    // At the closest point the source keeps its level; 1.5 s earlier it is 11.8 dB lower (1/R at 39 m).
    expect(Math.abs(peak - rmsDb(await dry(tone), 1, 5))).toBeLessThan(1);
    expect(peak - rmsDb(pass, at - 1.6, at - 1.4)).toBeGreaterThan(6);
    expect(channelDb(pass, 0, at - 1.5, at - 0.5) - channelDb(pass, 1, at - 1.5, at - 0.5)).toBeGreaterThan(10);
    expect(channelDb(pass, 1, at + 0.5, at + 1.5) - channelDb(pass, 0, at + 0.5, at + 1.5)).toBeGreaterThan(10);
  });

  it("keeps the duration, renders no NaN and keeps the onset even at a fast pass", async () => {
    expect(seconds(pass)).toBeCloseTo(6, 3);
    expect(nonFinite(pass)).toBe(0);
    // A jet at 600 km/h shifts the pitch almost an octave; with no level falloff the burst must still start at 0.5 s.
    const burst = await makeSignal(tmp.dir, "burst-pass", "anoisesrc=d=1:c=pink:a=0.3:r=48000:seed=11,adelay=delays=500:all=1,apad=pad_dur=2");
    const fast = await wet(burst, [{ effect: "doppler", params: { at: 2, speed: 600, distance: 50, falloff: 0, air: 0 } }]);
    expect(seconds(fast)).toBeCloseTo(3.5, 3);
    const start = firstAbove(fast, 0.05) / RATE;
    expect(Math.abs(start - 0.5)).toBeLessThan(1 / 24);
  });
});
