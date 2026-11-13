import { chain, n, slope } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;
const slopeParam = {
  type: "enum",
  id: "slope",
  label: "Slope",
  options: ["12", "24", "48"],
  default: "24",
  description: "dB per octave. Steeper = more abrupt cut.",
} as const;

export const filterEffects: EffectDefinition[] = [
  {
    id: "lowpass",
    name: "Low pass",
    category: "filter",
    description: "Lets the lows through and cuts the highs above the cutoff frequency.",
    whenToUse:
      "To dull a sound, push music into the background, fake something behind a door, or set up a drop (filter, then open).",
    tags: ["eq", "muffled", "background", "dark"],
    params: [
      { type: "number", id: "freq", label: "Cutoff", min: 40, max: 18000, default: 800, unit: "Hz", scale: "log" },
      slopeParam,
      { type: "number", id: "q", label: "Resonance (Q)", min: 0.3, max: 8, default: 0.707, step: 0.01 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, slope(`lowpass=f=${n(num(p, "freq"))}:width_type=q:w=${n(num(p, "q"))}`, Number(p.slope))),
  },
  {
    id: "highpass",
    name: "High pass",
    category: "filter",
    description: "Cuts the lows below the cutoff frequency.",
    whenToUse: "To clean rumble from voices (80–120 Hz), make music thin and distant, or suggest a small speaker.",
    tags: ["eq", "cleanup", "thin", "voice"],
    params: [
      { type: "number", id: "freq", label: "Cutoff", min: 20, max: 8000, default: 200, unit: "Hz", scale: "log" },
      slopeParam,
      { type: "number", id: "q", label: "Resonance (Q)", min: 0.3, max: 8, default: 0.707, step: 0.01 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, slope(`highpass=f=${n(num(p, "freq"))}:width_type=q:w=${n(num(p, "q"))}`, Number(p.slope))),
  },
  {
    id: "bandpass",
    name: "Band pass",
    category: "filter",
    description: "Keeps only a band of frequencies around the center.",
    whenToUse: "To isolate a slice (a voice on a speaker, a nasal sound) or as the base of radio and phone effects.",
    tags: ["eq", "band", "nasal"],
    params: [
      { type: "number", id: "freq", label: "Center", min: 100, max: 8000, default: 1200, unit: "Hz", scale: "log" },
      { type: "number", id: "octaves", label: "Width", min: 0.3, max: 5, default: 2, step: 0.1, unit: "oct" },
    ],
    build: (p, ctx) => {
      const f = num(p, "freq");
      const half = Math.pow(2, num(p, "octaves") / 2);
      return chain(ctx.input, ctx.output, [
        ...slope(`highpass=f=${n(f / half)}`, 24),
        ...slope(`lowpass=f=${n(Math.min(20000, f * half))}`, 24),
      ]);
    },
  },
  {
    id: "eq",
    name: "Three-band EQ",
    category: "filter",
    description: "Adjusts lows, mids and highs.",
    whenToUse: "To add body (lows), presence (2–4 kHz mids) or air (highs) to a voice or music.",
    tags: ["eq", "tone", "balance"],
    params: [
      { type: "number", id: "low", label: "Lows (120 Hz)", min: -18, max: 18, default: 3, unit: "dB", step: 0.5 },
      { type: "number", id: "mid", label: "Mids", min: -18, max: 18, default: 4, unit: "dB", step: 0.5 },
      { type: "number", id: "midFreq", label: "Mid freq.", min: 300, max: 6000, default: 2500, unit: "Hz", scale: "log" },
      { type: "number", id: "high", label: "Highs (8 kHz)", min: -18, max: 18, default: 3, unit: "dB", step: 0.5 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `bass=g=${n(num(p, "low"))}:f=120`,
        `equalizer=f=${n(num(p, "midFreq"))}:t=q:w=1:g=${n(num(p, "mid"))}`,
        `treble=g=${n(num(p, "high"))}:f=8000`,
      ]),
  },
  {
    id: "muffled",
    name: "Behind the wall",
    category: "filter",
    description: "Dull sound with lows that bleed through, as if from the next room.",
    whenToUse:
      "Party music on the other side of a door, neighbors, an argument in another room, or the outside world heard from inside a car.",
    tags: ["wall", "door", "neighbor", "party", "muffled"],
    params: [
      { type: "number", id: "thickness", label: "Thickness", min: 0, max: 1, default: 0.6, step: 0.01 },
      { type: "number", id: "boom", label: "Bleeding lows", min: 0, max: 12, default: 5, unit: "dB", step: 0.5 },
    ],
    build: (p, ctx) => {
      const t = num(p, "thickness");
      const cutoff = 1600 * (1 - t) + 250 * t;
      return chain(ctx.input, ctx.output, [
        ...slope(`lowpass=f=${n(cutoff)}`, 36),
        `bass=g=${n(num(p, "boom"))}:f=90`,
        `aecho=0.9:0.6:18|31:0.25|0.15`,
        `volume=${n(-t * 4)}dB`,
      ]);
    },
  },
];
