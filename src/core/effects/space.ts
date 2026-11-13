import { chain, convolutionReverb, n, slope, vibrato } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;

/** Preset spaces: decay (s), high damping (Hz), pre-delay (ms). */
export const SPACES = {
  bathroom: { decay: 0.9, damping: 9000, predelay: 4, lowcut: 300 },
  room: { decay: 0.6, damping: 6000, predelay: 8, lowcut: 150 },
  studio: { decay: 0.35, damping: 7000, predelay: 2, lowcut: 200 },
  hall: { decay: 2.2, damping: 5000, predelay: 25, lowcut: 100 },
  cathedral: { decay: 5.5, damping: 3500, predelay: 45, lowcut: 80 },
  cave: { decay: 3.2, damping: 2500, predelay: 30, lowcut: 60 },
  stadium: { decay: 3.8, damping: 4000, predelay: 70, lowcut: 200 },
} as const;
export type SpaceName = keyof typeof SPACES;

export const spaceEffects: EffectDefinition[] = [
  {
    id: "reverb",
    name: "Reverb",
    category: "space",
    description: "Convolution reverb with preset spaces (bathroom, room, hall, cathedral, cave, stadium).",
    whenToUse:
      "To place a voice or sound in a physical place, give an epic moment scale, or glue together sounds that are too dry.",
    tags: ["space", "room", "echo", "ambience", "epic"],
    hasTail: true,
    params: [
      { type: "enum", id: "space", label: "Space", options: Object.keys(SPACES), default: "hall" },
      { type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 0.35, step: 0.01 },
      { type: "number", id: "size", label: "Size", min: 0.25, max: 2.5, default: 1, step: 0.05, description: "Multiplies the space's decay." },
    ],
    build: (p, ctx) => {
      const s = SPACES[p.space as SpaceName];
      return convolutionReverb(ctx, ctx.input, ctx.output, {
        decay: s.decay * num(p, "size"),
        damping: s.damping,
        predelayMs: s.predelay * num(p, "size"),
        lowcut: s.lowcut,
        mix: num(p, "mix"),
      });
    },
  },
  {
    id: "echo",
    name: "Echo / delay",
    category: "space",
    description: "Regular repeats that fade away.",
    whenToUse: "For the end of a line, shouting across mountains, memory effects, or closing a video with a fading tail.",
    tags: ["delay", "repeat", "mountain", "tail"],
    hasTail: true,
    params: [
      { type: "number", id: "time", label: "Time", min: 40, max: 1500, default: 320, unit: "ms" },
      { type: "number", id: "feedback", label: "Feedback", min: 0.05, max: 0.85, default: 0.45, step: 0.01 },
      { type: "number", id: "repeats", label: "Repeats", min: 1, max: 8, default: 4, step: 1 },
      { type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
    build: (p, ctx) => {
      const count = Math.round(num(p, "repeats"));
      const delays = Array.from({ length: count }, (_, i) => n(num(p, "time") * (i + 1)));
      const decays = Array.from({ length: count }, (_, i) => n(Math.pow(num(p, "feedback"), i + 1) * num(p, "mix")));
      return chain(ctx.input, ctx.output, [`aecho=1:1:${delays.join("|")}:${decays.join("|")}`]);
    },
  },
  {
    id: "slapback",
    name: "Slapback",
    category: "space",
    description: "A single short bounce (80–140 ms), typical of rockabilly and alleys.",
    whenToUse: "For a hallway or alley, a retro voice, or hits that need to bounce off nearby walls.",
    tags: ["delay", "alley", "retro", "bounce"],
    hasTail: true,
    params: [
      { type: "number", id: "time", label: "Time", min: 50, max: 200, default: 110, unit: "ms" },
      { type: "number", id: "level", label: "Level", min: 0, max: 1, default: 0.45, step: 0.01 },
    ],
    build: (p, ctx) => chain(ctx.input, ctx.output, [`aecho=1:1:${n(num(p, "time"))}:${n(num(p, "level"))}`]),
  },
  {
    id: "distance",
    name: "Far away",
    category: "space",
    description: "Pushes the source away: fewer highs, less level and relatively more reverb.",
    whenToUse: "Someone shouting from afar, a siren blocks away, a character walking away from the camera.",
    tags: ["far", "distance", "background", "outdoor"],
    hasTail: true,
    params: [
      { type: "number", id: "distance", label: "Distance", min: 0, max: 1, default: 0.6, step: 0.01 },
      { type: "enum", id: "space", label: "Setting", options: ["outdoor", "indoor"], default: "outdoor" },
    ],
    build: (p, ctx) => {
      const d = num(p, "distance");
      const mid = ctx.label("far");
      const outdoor = p.space === "outdoor";
      return [
        chain(ctx.input, mid, [
          `highpass=f=${n(80 + d * 220)}`,
          ...slope(`lowpass=f=${n(12000 * (1 - d) + 1800 * d)}`, 12),
          `volume=${n(-d * 14)}dB`,
        ]),
        convolutionReverb(ctx, mid, ctx.output, {
          decay: outdoor ? 1.4 : 1.0,
          damping: outdoor ? 3000 : 4500,
          predelayMs: outdoor ? 60 * d : 15,
          lowcut: 200,
          mix: 0.2 + d * 0.6,
        }),
      ].join(";");
    },
  },
  {
    id: "underwater",
    name: "Underwater",
    category: "space",
    description: "Highs almost gone, slow modulation and low resonances, like going under.",
    whenToUse:
      "When the camera goes into the water, for disorientation, fainting, being stunned or a blurry memory. Combine with from/to and a fade for the transition.",
    tags: ["water", "submerged", "pool", "stunned", "faint"],
    params: [
      { type: "number", id: "depth", label: "Depth", min: 0, max: 1, default: 0.6, step: 0.01 },
      { type: "number", id: "wobble", label: "Movement", min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
    build: (p, ctx) => {
      const d = num(p, "depth");
      const w = num(p, "wobble");
      const cutoff = 1100 * (1 - d) + 280 * d;
      return chain(ctx.input, ctx.output, [
        ...slope(`lowpass=f=${n(cutoff)}`, 36),
        `equalizer=f=${n(cutoff * 0.6)}:t=q:w=2:g=4`,
        vibrato(0.4 + w * 0.8, 0.1 + w * 0.4),
        `chorus=0.8:0.9:45|70:0.35|0.3:0.25|0.4:2|1.6`,
        `aecho=0.9:0.7:35|80:0.3|0.2`,
        `volume=${n(5 - d * 3)}dB`,
      ]);
    },
  },
];
