import { SAMPLE_RATE, type BuildContext } from "./types.js";

/** Formats numbers for ffmpeg: no exponent notation and bounded decimals. */
export function n(value: number, digits = 4): string {
  if (!Number.isFinite(value)) throw new Error(`Non-finite value in filtergraph: ${value}`);
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") || "0" : fixed;
}

/**
 * A file path as the value of a filter option inside a filtergraph (e.g. `amovie=filename=<path>`).
 * The graph parser and the filter's own option parser each strip one level of escaping, so every special
 * character is escaped twice. Windows paths use forward slashes, which ffmpeg accepts.
 */
export function filterPath(file: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(file) || file.startsWith("\\\\");
  return (windows ? file.replace(/\\/g, "/") : file).replace(/[\\:'[\],;= ]/g, (c) => `\\\\\\${c}`);
}

/** A linear chain: [in]f1,f2,...[out]. */
export function chain(input: string, output: string, filters: string[]): string {
  const body = filters.length ? filters.join(",") : "anull";
  return `[${input}]${body}[${output}]`;
}

/** Repeats a filter to steepen the slope (each 2-pole lowpass/highpass = 12 dB/oct). */
export function slope(filter: string, dbPerOct: number): string[] {
  const stages = Math.max(1, Math.round(dbPerOct / 12));
  return Array.from({ length: stages }, () => filter);
}

/** Stereo (decorrelated) noise source that lasts as long as the signal when mixed with duration=first. */
export function noiseSource(
  ctx: BuildContext,
  out: string,
  opts: { color: "white" | "pink" | "brown" | "velvet"; amplitude: number; filters?: string[]; density?: number; duration?: number },
): string {
  const l = ctx.label("nl");
  const r = ctx.label("nr");
  const extra = opts.filters?.length ? "," + opts.filters.join(",") : "";
  const density = opts.color === "velvet" ? `:density=${n(opts.density ?? 0.002, 5)}` : "";
  const duration = opts.duration ? `:d=${n(opts.duration)}` : "";
  const src = (seed: number, label: string) =>
    `anoisesrc=r=${SAMPLE_RATE}:a=${n(opts.amplitude, 5)}:c=${opts.color}${density}${duration}:seed=${seed}${extra}[${label}]`;
  return [src(ctx.seed, l), src(ctx.seed + 1, r), `[${l}][${r}]amerge=inputs=2[${out}]`].join(";");
}

/** Mixes [a] with [b] (b lasts as long as a). */
export function mixInto(a: string, b: string, out: string, weightB = 1): string {
  return `[${a}][${b}]amix=inputs=2:duration=first:normalize=0:weights=1 ${n(weightB)}[${out}]`;
}

/**
 * Gain of the convolved signal. With `irnorm=2` afir normalizes the IR by energy, so the reverb level
 * does not depend on its length; this factor leaves the pure reverb about 3 dB below the dry signal.
 * Without that normalization (ffmpeg's default) the tail sat ~35 dB lower and the reverb was inaudible.
 */
const REVERB_WET_GAIN = 0.35;

/**
 * One channel of a synthetic impulse response, like those of convolution reverbs:
 * sparse early reflections (velvet noise) + a diffuse tail where highs decay before lows.
 */
function reverbIrChannel(ctx: BuildContext, out: string, seed: number, o: { decay: number; damping: number; lowcut: number }): string {
  const er = ctx.label("er");
  const bright = ctx.label("tb");
  const dark = ctx.label("td");
  const erLen = Math.min(0.09, o.decay * 0.4);
  const src = (s: number, extra: string) => `anoisesrc=r=${SAMPLE_RATE}:a=0.5:c=white:seed=${s}:d=${n(o.decay)}${extra}`;
  return [
    `anoisesrc=r=${SAMPLE_RATE}:a=0.9:c=velvet:density=0.006:seed=${seed + 101}:d=${n(o.decay)},highpass=f=${n(o.lowcut)},` +
      `afade=t=out:st=0:d=${n(erLen)}:curve=exp[${er}]`,
    `${src(seed, `,highpass=f=${n(o.lowcut)},lowpass=f=${n(o.damping)},afade=t=out:st=0:d=${n(o.decay * 0.45)}:curve=exp`)}[${bright}]`,
    `${src(seed + 7, `,highpass=f=${n(o.lowcut)},lowpass=f=${n(o.damping * 0.3)},afade=t=out:st=0:d=${n(o.decay)}:curve=exp`)}[${dark}]`,
    `[${er}][${bright}][${dark}]amix=inputs=3:normalize=0:weights=0.5 0.7 0.9[${out}]`,
  ].join(";");
}

/**
 * The IR's `decay` is the length of its fades, which reach -100 dB: the measured RT60 (the time to fall 60 dB)
 * is 0.59 of it. Multiply a wanted RT60 by this to get the `decay` that gives it.
 */
export const DECAY_FOR_RT60 = 1 / 0.59;

/** Convolution reverb with a synthetic stereo IR (no external files or licenses). */
export function convolutionReverb(
  ctx: BuildContext,
  input: string,
  output: string,
  opts: { decay: number; damping: number; predelayMs: number; mix: number; lowcut?: number; dry?: number },
): string {
  const dry = ctx.label("rvd");
  const wet = ctx.label("rvw");
  const irL = ctx.label("irl");
  const irR = ctx.label("irr");
  const ir = ctx.label("ir");
  const conv = ctx.label("rvc");
  const shaped = ctx.label("rvs");
  const o = { decay: Math.max(0.08, opts.decay), damping: opts.damping, lowcut: opts.lowcut ?? 120 };
  const wetPost = [opts.predelayMs > 0 ? `adelay=delays=${n(opts.predelayMs)}:all=1` : "anull"];
  return [
    `[${input}]asplit=2[${dry}][${wet}]`,
    reverbIrChannel(ctx, irL, ctx.seed, o),
    reverbIrChannel(ctx, irR, ctx.seed + 31, o),
    `[${irL}][${irR}]amerge=inputs=2[${ir}]`,
    `[${wet}][${ir}]afir=irnorm=2:irlink=0[${conv}]`,
    chain(conv, shaped, wetPost),
    `[${dry}][${shaped}]amix=inputs=2:duration=first:normalize=0:weights=${n(opts.dry ?? 1 - opts.mix * 0.5)} ${n(opts.mix * REVERB_WET_GAIN)}[${output}]`,
  ].join(";");
}

/** asendcmd commands that automate a filter param between two values. */
export function ramp(
  target: string,
  param: string,
  opts: { start: number; duration: number; from: number; to: number; curve: "linear" | "exponential"; steps?: number },
): string {
  return `asendcmd=c='${rampCommands(target, param, opts).join(";")}'`;
}

export function rampCommands(
  target: string,
  param: string,
  opts: { start: number; duration: number; from: number; to: number; curve: "linear" | "exponential"; steps?: number },
): string[] {
  const steps = opts.steps ?? Math.max(8, Math.min(200, Math.round(opts.duration / 0.02)));
  const cmds: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const value =
      opts.curve === "exponential" && opts.from > 0 && opts.to > 0
        ? opts.from * Math.pow(opts.to / opts.from, x)
        : opts.from + (opts.to - opts.from) * x;
    cmds.push(`${n(opts.start + opts.duration * x)} ${target} ${param} ${n(value)}`);
  }
  return cmds;
}

/**
 * Speakers simulated by convolution, like Speakerphone: each model is a short IR of damped resonances
 * (cone, cabinet, horn) plus the device's bandwidth.
 */
export const SPEAKERS = {
  earpiece: { band: [300, 3400], res: [[950, 4, 1], [2200, 5, 0.8], [3100, 6, 0.6]] },
  phone: { band: [480, 9000], res: [[820, 3, 0.6], [2600, 4, 1], [5200, 5, 0.5]] },
  laptop: { band: [350, 12000], res: [[900, 3, 0.7], [2800, 3, 1], [6200, 4, 0.6]] },
  radio: { band: [250, 4800], res: [[560, 3, 1], [1300, 4, 0.8], [2900, 5, 0.5]] },
  tv: { band: [170, 7000], res: [[420, 2.5, 0.8], [1100, 3, 1], [3600, 4, 0.5]] },
  walkie: { band: [500, 3000], res: [[750, 5, 0.8], [1500, 6, 1], [2500, 7, 0.7]] },
  megaphone: { band: [420, 4500], res: [[900, 6, 0.8], [1700, 8, 1], [3300, 8, 0.7]] },
  pa: { band: [140, 9000], res: [[480, 2, 0.6], [2000, 3, 0.8], [4500, 3, 0.4]] },
} as const;
export type SpeakerModel = keyof typeof SPEAKERS;

export function speaker(ctx: BuildContext, input: string, output: string, model: SpeakerModel, mix = 1): string {
  const s = SPEAKERS[model];
  const ir = ctx.label("spk");
  const band = ctx.label("spb");
  // Impulse + resonances e^(-πft/Q)·sin(2πft): the "coloring" of a cone and its cabinet.
  const terms = s.res.map(([f, q, a]) => `${n(a * 0.35)}*exp(-t*${n((Math.PI * f) / q, 2)})*sin(2*PI*${f}*t)`).join("+");
  const expr = `if(lt(t,0.00003),1,0)+${terms}`;
  const parts = [
    chain(input, band, bandLimit(s.band[0], s.band[1], 24)),
    `aevalsrc='${expr}':s=${SAMPLE_RATE}:c=stereo:d=0.04[${ir}]`,
  ];
  // afir with irnorm=2 leaves the voice ~4 dB louder than the input: compensated so an A/B does not mislead.
  if (mix >= 1) {
    parts.push(`[${band}][${ir}]afir=irnorm=2,volume=-4dB[${output}]`);
  } else {
    const a = ctx.label("spa");
    const b = ctx.label("spc");
    const c = ctx.label("spd");
    parts.push(`[${band}]asplit=2[${a}][${b}]`, `[${b}][${ir}]afir=irnorm=2,volume=-4dB[${c}]`);
    parts.push(`[${a}][${c}]amix=inputs=2:normalize=0:weights=${n(1 - mix)} ${n(mix)}[${output}]`);
  }
  return parts.join(";");
}

/** Horns, radios and phones: band-limited with a steep slope. */
export function bandLimit(low: number, high: number, db = 24): string[] {
  return [...slope(`highpass=f=${n(low)}`, db), ...slope(`lowpass=f=${n(high)}`, db)];
}

/** Saturation with drive in dB and level compensation. */
export function drive(db: number, type = "tanh"): string[] {
  if (db <= 0) return [];
  return [`volume=${n(db)}dB`, `asoftclip=type=${type}`, `volume=${n(-db * 0.6)}dB`];
}

/** dB to linear gain. */
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/**
 * Vibrato as a modulated delay (a one-voice chorus with no dry signal).
 * ffmpeg 7.1's `vibrato` filter reads uninitialized memory and sometimes emits NaN or huge values,
 * which then poison the following IIR filters. `depth` = 1 means ±1 semitone.
 */
export function vibrato(speedHz: number, depth: number): string {
  if (depth <= 0) return "anull";
  const depthMs = Math.min(25, (depth * 9.47) / speedHz);
  return `chorus=0:1:${n(depthMs + 0.5)}:1:${n(speedHz)}:${n(depthMs)}`;
}

/**
 * Tape or record wobble (wow + flutter), like RC-20's Wobble module: two slow and two fast oscillators
 * with non-multiple frequencies, so the drift does not sound periodic.
 */
export function wobble(wow: number, flutter: number): string[] {
  const out: string[] = [];
  if (wow > 0) out.push(vibrato(0.53, wow * 0.55), vibrato(0.87, wow * 0.35));
  if (flutter > 0) out.push(vibrato(6.3, flutter * 0.12), vibrato(9.7, flutter * 0.08));
  return out;
}

/**
 * Irregular level drops (tape dropouts, a signal cutting out), like RC-20's Loss/Magnetic module.
 * The product of sines with incommensurable frequencies gives sporadic peaks that become short cuts.
 */
export function dropouts(depth: number, rate = 1): string {
  if (depth <= 0) return "anull";
  const r = (x: number) => n(x * rate);
  const p = `pow(max(0,sin(2*PI*${r(0.31)}*t+1)*sin(2*PI*${r(0.73)}*t)*sin(2*PI*${r(1.37)}*t+2)),3)`;
  return `volume='1-${n(Math.min(1, depth))}*min(1,${p}*14)':eval=frame`;
}

/** Characteristic noises to add to a signal (all last as long as the signal when mixed with duration=first). */
export const noises = {
  /** Tape or tube hiss. */
  hiss: (amount: number, low = 2000, high = 9000) => (ctx: BuildContext, out: string) =>
    noiseSource(ctx, out, { color: "pink", amplitude: 0.035 * amount, filters: [`highpass=f=${n(low)}`, `lowpass=f=${n(high)}`] }),
  /** Vinyl dust: fine, dense clicks. */
  dust: (amount: number, rpmFactor = 1) => (ctx: BuildContext, out: string) =>
    noiseSource(ctx, out, {
      color: "velvet",
      amplitude: 0.3 * amount,
      density: (0.0005 + amount * 0.0015) * rpmFactor,
      filters: ["highpass=f=1500", "lowpass=f=8000"],
    }),
  /** Pops: louder, sparser clicks. */
  pops: (amount: number) => (ctx: BuildContext, out: string) =>
    noiseSource(ctx, out, { color: "velvet", amplitude: 0.7 * amount, density: 0.00004 + amount * 0.00008, filters: ["lowpass=f=4000"] }),
  /** Scratch: one click per record turn, like iZotope Vinyl. */
  scratch: (amount: number, rpm: number) => (_ctx: BuildContext, out: string) => {
    const period = n(60 / rpm, 5);
    return `aevalsrc='${n(0.25 * amount, 4)}*exp(-mod(t,${period})*900)*sin(2*PI*2300*mod(t,${period}))':s=${SAMPLE_RATE}:c=stereo[${out}]`;
  },
  /** Turntable motor rumble. */
  rumble: (amount: number) => (ctx: BuildContext, out: string) =>
    noiseSource(ctx, out, { color: "brown", amplitude: 0.25 * amount, filters: ["lowpass=f=70", "highpass=f=18"] }),
  /** Mains hum: fundamental plus odd harmonics. */
  hum: (amount: number, hz: number) => (_ctx: BuildContext, out: string) => {
    const w = (k: number) => `2*PI*${n(hz * k)}*t`;
    return `aevalsrc=${n(0.012 * amount, 5)}*(sin(${w(1)})+0.5*sin(${w(3)})+0.25*sin(${w(5)})):s=${SAMPLE_RATE}:c=stereo[${out}]`;
  },
  /** Radio static: mid-band noise that crackles in bursts. */
  static: (amount: number) => (ctx: BuildContext, out: string) =>
    noiseSource(ctx, out, {
      color: "white",
      amplitude: 0.05 * amount,
      filters: ["highpass=f=900", "lowpass=f=5000", `volume='0.35+0.65*pow(abs(sin(2*PI*1.7*t)*sin(2*PI*2.9*t+1)),2)':eval=frame`],
    }),
};

export type NoiseMaker = (ctx: BuildContext, out: string) => string;

/** Processes the signal and adds noises to it (each as long as the audio). */
export function withNoise(ctx: BuildContext, filters: string[], makers: NoiseMaker[]): string {
  if (!makers.length) return chain(ctx.input, ctx.output, filters);
  const parts: string[] = [];
  let current = ctx.label("sig");
  parts.push(chain(ctx.input, current, filters));
  makers.forEach((make, i) => {
    const noise = ctx.label("nz");
    const out = i === makers.length - 1 ? ctx.output : ctx.label("mx");
    parts.push(make(ctx, noise));
    parts.push(mixInto(current, noise, out));
    current = out;
  });
  return parts.join(";");
}

/**
 * Like withNoise, but the signal first goes through a simulated speaker.
 * Noises are added after the speaker.
 */
export function throughSpeaker(
  ctx: BuildContext,
  model: SpeakerModel,
  pre: string[],
  post: string[],
  makers: NoiseMaker[],
): string {
  const a = ctx.label("pre");
  const b = ctx.label("spo");
  const parts = [chain(ctx.input, a, pre), speaker(ctx, a, b, model)];
  parts.push(withNoise({ ...ctx, input: b }, post, makers));
  return parts.join(";");
}
