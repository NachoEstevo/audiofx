import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EFFECTS, analyzeFile, applyToFile, compile } from "../src/core/index.js";
import { makeSignal, nonFinite, render, rmsDb, seconds, sine, tempDir } from "./helpers.js";

const tmp = tempDir();
let mixed: string;
let burst: string;
let sample: string;

/**
 * Params that would hide the signal onset from the burst fixture, turned off to measure the signal latency:
 * effects that add their own noise or tones from second 0, and level ramps that are the effect's point.
 */
const QUIET_SOURCES: Record<string, Record<string, number>> = {
  phonograph: { crackle: 0, noise: 0 },
  vinyl: { dust: 0, scratch: 0, rumble: 0 },
  tinnitus: { level: 0 },
  hit: { level: -40 },
  riser: { level: -40 },
  whoosh: { level: -40 },
  "sub-drop": { level: -40 },
  braam: { level: -40 },
  layer: { level: -60 },
  // Its distance falloff leaves the burst's start ~8 dB under its end, right at the 25% threshold (1 in 25 noise
  // seeds failed). Onset with a fast pass is also checked in tools.test.ts.
  doppler: { falloff: 0 },
};

/** Effects that cannot run on defaults alone: `layer` needs the sample to mix in. */
const REQUIRED: Record<string, () => Record<string, string>> = {
  layer: () => ({ file: sample }),
};
const required = (id: string) => REQUIRED[id]?.() ?? {};

/**
 * Effects that should change nothing on a test signal with no background noise or stereo image:
 * the gate needs noise between phrases, stereo width is measured separately (it cancels in mono),
 * the limiter's default is a safety ceiling that only catches overs (checked with a hot signal) and
 * the de-esser only acts on sibilance (checked with high-band bursts in tools.test.ts).
 */
const NOT_AUDIBLE_BY_DESIGN: Record<string, string> = {
  gate: "only acts on background noise",
  limiter: "checked with a signal that goes over the ceiling",
  "stereo-width": "checked by measuring the side",
  "de-esser": "only acts on sibilance; checked with high-band bursts",
};

/** Residual (dB) between two mono-summed signals after level matching and finding the best alignment (±50 ms). */
function residualDb(a: Float32Array, b: Float32Array): number {
  const mono = (x: Float32Array) => {
    const m = new Float32Array(x.length / 2);
    let e = 0;
    for (let i = 0; i < m.length; i++) {
      m[i] = (x[2 * i] + x[2 * i + 1]) / 2;
      e += m[i] * m[i];
    }
    const k = 1 / Math.sqrt(e / m.length + 1e-20);
    for (let i = 0; i < m.length; i++) m[i] *= k;
    return m;
  };
  const len = Math.min(a.length, b.length);
  const x = mono(a.subarray(0, len));
  const y = mono(b.subarray(0, len));
  let best = -Infinity;
  for (let lag = -2400; lag <= 2400; lag += 48) {
    let s = 0;
    let count = 0;
    for (let i = Math.max(0, lag); i < x.length && i - lag < y.length; i += 4) {
      s += x[i] * y[i - lag];
      count++;
    }
    best = Math.max(best, s / count);
  }
  return 10 * Math.log10(Math.max(1e-6, 2 - 2 * best));
}

/** First instant (s) where the 5 ms envelope exceeds 25% of its maximum. */
function onset(x: Float32Array): number {
  const win = 240;
  const env: number[] = [];
  for (let i = 0; i + win * 2 <= x.length; i += win * 2) {
    let s = 0;
    for (let j = i; j < i + win * 2; j++) s += x[j] * x[j];
    env.push(Math.sqrt(s / (win * 2)));
  }
  const max = Math.max(...env);
  return (env.findIndex((v) => v > max * 0.25) * win) / 48000;
}

beforeAll(async () => {
  burst = await makeSignal(
    tmp.dir,
    "burst",
    // Seeded: with a random burst, the onset detector read the steep lowpasses 30–45 ms late on some runs.
    "anoisesrc=d=1:c=pink:a=0.3:r=48000:seed=7,adelay=delays=500:all=1,apad=pad_dur=0.5",
  );
  sample = await makeSignal(tmp.dir, "sample", "anoisesrc=d=0.6:c=pink:a=0.5:r=48000:seed=11,afade=t=out:st=0.1:d=0.5");
  mixed = await makeSignal(
    tmp.dir,
    "mixed",
    "sine=f=220:d=3:r=48000,volume=0.2[a];anoisesrc=d=3:c=pink:a=0.1:r=48000:seed=3[b];[a][b]amix=inputs=2",
  );
});
afterAll(() => tmp.cleanup());

describe("whole catalog", () => {
  it.each(EFFECTS.map((e) => [e.id, e] as const))("%s processes audio without NaN or silence", async (_id, effect) => {
    const out = await render(mixed, [{ effect: effect.id, params: required(effect.id) }]);
    expect(nonFinite(out)).toBe(0);
    expect(rmsDb(out)).toBeGreaterThan(-70);
    if (!effect.changesDuration) {
      // Internal echoes (aecho) can lengthen the tail by a few ms; they must never shorten the audio.
      const expected = 3 + (effect.hasTail ? 3 : 0);
      expect(seconds(out)).toBeGreaterThan(expected - 0.05);
      expect(seconds(out)).toBeLessThan(expected + 1.5);
    }
  });

  it.each(EFFECTS.filter((e) => !e.changesDuration).map((e) => [e.id] as const))(
    "%s does not shift the sound onset by more than one frame (24 fps)",
    async (id) => {
      const out = await render(burst, [{ effect: id, params: { ...required(id), ...QUIET_SOURCES[id] } }], { tail: 0 });
      expect(Math.abs(onset(out) - 0.5)).toBeLessThan(1 / 24);
    },
  );

  it.each(EFFECTS.filter((e) => !NOT_AUDIBLE_BY_DESIGN[e.id]).map((e) => [e.id] as const))(
    "%s audibly changes the sound with its defaults",
    async (id) => {
      const dry = await render(mixed, [{ effect: "gain", params: { db: 0 } }], { tail: 0 });
      const wet = await render(mixed, [{ effect: id, params: required(id) }], { tail: 0 });
      const levelChange = Math.abs(rmsDb(wet) - rmsDb(dry));
      // Waveform difference with matched level and best alignment: > -20 dB is clearly audible.
      expect(Math.max(residualDb(dry, wet), levelChange > 3 ? 0 : -99)).toBeGreaterThan(-20);
    },
  );

  it("stereo-width widens a mono source without breaking the mono sum", async () => {
    const out = await render(mixed, [{ effect: "stereo-width", params: { width: 1.8 } }], { tail: 0 });
    const side = new Float32Array(out.length / 2);
    const mid = new Float32Array(out.length / 2);
    for (let i = 0; i < side.length; i++) {
      side[i] = (out[2 * i] - out[2 * i + 1]) / 2;
      mid[i] = (out[2 * i] + out[2 * i + 1]) / 2;
    }
    const db = (x: Float32Array) => 10 * Math.log10(x.reduce((a, v) => a + v * v, 0) / x.length + 1e-20);
    expect(db(side) - db(mid)).toBeGreaterThan(-15);
    const dryMid = rmsDb(await render(mixed, [{ effect: "gain", params: { db: 0 } }], { tail: 0 }));
    expect(Math.abs(db(mid) - dryMid)).toBeLessThan(1);
  });

  it("every effect has a description and usage guidance for agents", () => {
    for (const e of EFFECTS) {
      expect(e.description.length, e.id).toBeGreaterThan(20);
      expect(e.whenToUse.length, e.id).toBeGreaterThan(30);
      expect(e.tags.length, e.id).toBeGreaterThan(1);
    }
  });
});

describe("frequency response", () => {
  it("lowpass at 800 Hz attenuates 5 kHz and passes 200 Hz", async () => {
    const ref = rmsDb(await render(await sine(tmp.dir, 200), [{ effect: "gain", params: { db: 0 } }]), 0.2, 1.8);
    const low = await render(await sine(tmp.dir, 200), [{ effect: "lowpass", params: { freq: 800 } }]);
    const high = await render(await sine(tmp.dir, 5000), [{ effect: "lowpass", params: { freq: 800 } }]);
    expect(Math.abs(rmsDb(low, 0.2, 1.8) - ref)).toBeLessThan(1);
    expect(ref - rmsDb(high, 0.2, 1.8)).toBeGreaterThan(40);
  });

  it("highpass at 200 Hz attenuates 50 Hz and passes 2 kHz", async () => {
    const ref = rmsDb(await render(await sine(tmp.dir, 2000), [{ effect: "gain", params: { db: 0 } }]), 0.2, 1.8);
    const pass = await render(await sine(tmp.dir, 2000), [{ effect: "highpass", params: { freq: 200 } }]);
    const cut = await render(await sine(tmp.dir, 50), [{ effect: "highpass", params: { freq: 200 } }]);
    expect(Math.abs(rmsDb(pass, 0.2, 1.8) - ref)).toBeLessThan(1);
    expect(ref - rmsDb(cut, 0.2, 1.8)).toBeGreaterThan(30);
  });

  it("telephone keeps the voice band and cuts lows and highs", async () => {
    const steps = [{ effect: "telephone", params: { noise: 0 } }];
    const mid = rmsDb(await render(await sine(tmp.dir, 1000), steps), 0.2, 1.8);
    expect(mid - rmsDb(await render(await sine(tmp.dir, 100), steps), 0.2, 1.8)).toBeGreaterThan(20);
    expect(mid - rmsDb(await render(await sine(tmp.dir, 7000), steps), 0.2, 1.8)).toBeGreaterThan(20);
  });

  it("filter-sweep opens the highs over time", async () => {
    const noise = await makeSignal(tmp.dir, "noise", "anoisesrc=d=3:c=white:a=0.2:r=48000,highpass=f=4000");
    const out = await render(noise, [
      { effect: "filter-sweep", params: { fromFreq: 300, toFreq: 18000, start: 0.5, duration: 1.5 } },
    ]);
    expect(rmsDb(out, 2.2, 3) - rmsDb(out, 0, 0.5)).toBeGreaterThan(25);
  });
});

describe("time windows", () => {
  it("applies the effect only inside from/to and leaves the rest dry", async () => {
    const input = await sine(tmp.dir, 5000, 3);
    const dry = await render(input, [{ effect: "gain", params: { db: 0 } }]);
    const out = await render(input, [{ effect: "underwater", from: 1, to: 2, fade: 0.05 }]);
    expect(Math.abs(rmsDb(out, 0, 0.9) - rmsDb(dry, 0, 0.9))).toBeLessThan(0.5);
    expect(rmsDb(dry, 1.2, 1.8) - rmsDb(out, 1.2, 1.8)).toBeGreaterThan(20);
    expect(Math.abs(rmsDb(out, 2.2, 2.9) - rmsDb(dry, 2.2, 2.9))).toBeLessThan(0.5);
  });

  it("rejects windows on duration-changing effects and inverted windows", () => {
    expect(() => compile([{ effect: "slowmo", from: 1 }])).toThrow(/changes the audio duration/);
    expect(() => compile([{ effect: "lowpass", from: 2, to: 1 }])).toThrow(/greater than/);
  });
});

describe("duration", () => {
  it("slowmo stretches by the speed", async () => {
    const out = await render(await sine(tmp.dir, 440, 2), [{ effect: "slowmo", params: { speed: 0.5 } }]);
    expect(seconds(out)).toBeCloseTo(4, 1);
  });

  it("tape-stop ends at at + length", async () => {
    const out = await render(await sine(tmp.dir, 440, 4), [{ effect: "tape-stop", params: { at: 1, length: 1 } }]);
    expect(seconds(out)).toBeCloseTo(2, 1);
  });
});

describe("cinema: effects anchored to a moment", () => {
  let tone: string;
  beforeAll(async () => {
    tone = await makeSignal(tmp.dir, "tone4", "sine=f=330:d=4:r=48000,volume=0.1");
  });

  it("hit, sub-drop and braam add energy from `at`, not before", async () => {
    for (const effect of ["hit", "sub-drop", "braam"]) {
      const out = await render(tone, [{ effect, params: { at: 2 } }]);
      const dry = await render(tone, [{ effect: "gain", params: { db: 0 } }]);
      expect(Math.abs(rmsDb(out, 0.5, 1.9) - rmsDb(dry, 0.5, 1.9)), effect).toBeLessThan(0.5);
      expect(rmsDb(out, 2, 2.6) - rmsDb(dry, 2, 2.6), effect).toBeGreaterThan(6);
    }
  });

  it("riser grows until `at` and stops dead", async () => {
    const out = await render(tone, [{ effect: "riser", params: { at: 2.5, length: 2 } }]);
    const dry = await render(tone, [{ effect: "gain", params: { db: 0 } }]);
    expect(rmsDb(out, 2.1, 2.5) - rmsDb(out, 0.6, 1)).toBeGreaterThan(6);
    expect(Math.abs(rmsDb(out, 2.6, 3.5) - rmsDb(dry, 2.6, 3.5))).toBeLessThan(1);
  });

  it("drop-gap leaves silence just before `at` and comes back at `at`", async () => {
    const out = await render(tone, [{ effect: "drop-gap", params: { at: 2, gap: 0.5 } }]);
    const dry = await render(tone, [{ effect: "gain", params: { db: 0 } }]);
    expect(rmsDb(out, 1.8, 1.98)).toBeLessThan(rmsDb(dry, 1.8, 1.98) - 40);
    expect(Math.abs(rmsDb(out, 2.05, 2.5) - rmsDb(dry, 2.05, 2.5))).toBeLessThan(1);
  });

  it("stop-tail cuts the signal and leaves a decaying tail", async () => {
    const out = await render(tone, [{ effect: "stop-tail", params: { at: 2, decay: 2 } }]);
    const early = rmsDb(out, 2.05, 2.4);
    expect(early).toBeGreaterThan(-45);
    expect(rmsDb(out, 4, 4.5)).toBeLessThan(early - 10);
  });

  it("stutter lengthens the audio by (repeats - 1) × slice", async () => {
    const out = await render(tone, [{ effect: "stutter", params: { at: 1, slice: 0.2, repeats: 4 } }], { tail: 0 });
    expect(seconds(out)).toBeCloseTo(4.6, 1);
  });
});

describe("loudness and files", () => {
  it("normalizes to -14 LUFS", async () => {
    const out = `${tmp.dir}/loud.wav`;
    await applyToFile(mixed, out, [{ effect: "loudness", params: { target: -14 } }]);
    const a = await analyzeFile(out);
    expect(a.integratedLufs).not.toBeNull();
    expect(Math.abs(a.integratedLufs! + 14)).toBeLessThan(1);
  });

  it("the default limiter holds a hot signal under its -1 dB ceiling without raising a quiet one", async () => {
    const peakDb = (x: Float32Array) => 20 * Math.log10(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
    const hot = await render(mixed, [{ effect: "gain", params: { db: 18 } }, { effect: "limiter" }], { tail: 0 });
    expect(peakDb(hot)).toBeLessThan(-0.9);
    const dry = await render(mixed, [{ effect: "gain", params: { db: 0 } }], { tail: 0 });
    const safe = await render(mixed, [{ effect: "limiter" }], { tail: 0 });
    expect(Math.abs(rmsDb(safe) - rmsDb(dry))).toBeLessThan(0.5);
  });

  it("noises are reproducible with the same seed", async () => {
    const a = await render(mixed, [{ effect: "vinyl" }], { seed: 7 });
    const b = await render(mixed, [{ effect: "vinyl" }], { seed: 7 });
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });
});
