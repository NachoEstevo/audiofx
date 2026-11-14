import { chain, chorus, convolutionReverb, delayMix, n, peakLimiter, vibrato } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;
const pitchRatio = (semitones: number) => Math.pow(2, semitones / 12);

export const modulationEffects: EffectDefinition[] = [
  {
    id: "chorus",
    name: "Chorus",
    category: "modulation",
    description: "Doubles the signal with small timing variations: it sounds wider and brighter.",
    whenToUse: "To thicken pads or voices, or for a dreamy or soft-crowd feeling.",
    tags: ["wide", "double", "dreamy"],
    params: [
      { type: "number", id: "depth", label: "Depth", min: 0, max: 1, default: 0.5, step: 0.01 },
      { type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
    build: (p, ctx) => {
      const d = num(p, "depth");
      const m = num(p, "mix");
      const doubled = ctx.label("chod");
      return [
        chorus({ ...ctx, output: doubled }, 1 - m * 0.37, [
          { speed: 0.3, depth: 1 + d * 2, gain: m * 0.45 },
          { speed: 0.45, depth: 1.5 + d * 2, gain: m * 0.36 },
          { speed: 0.6, depth: 1 + d * 3, gain: m * 0.315 },
        ]),
        chain(doubled, ctx.output, m > 0 ? [peakLimiter()] : []),
      ].join(";");
    },
  },
  {
    id: "flanger",
    name: "Flanger",
    category: "modulation",
    description: "A metallic comb-filter sweep, like a jet.",
    whenToUse: "Psychedelic transitions, teleportation, sci-fi sounds or a 'something is wrong' effect.",
    tags: ["jet", "metallic", "psychedelic", "sci-fi"],
    params: [
      { type: "number", id: "speed", label: "Speed", min: 0.1, max: 5, default: 0.4, step: 0.05, unit: "Hz" },
      { type: "number", id: "depth", label: "Depth", min: 0, max: 10, default: 4, step: 0.1, unit: "ms" },
      { type: "number", id: "regen", label: "Feedback", min: -95, max: 95, default: 40, step: 1, unit: "%" },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `flanger=delay=1:depth=${n(num(p, "depth"))}:regen=${n(num(p, "regen"))}:speed=${n(num(p, "speed"))}:width=70`,
      ]),
  },
  {
    id: "phaser",
    name: "Phaser",
    category: "modulation",
    description: "A smooth, swirling phase sweep.",
    whenToUse: "Soft sci-fi ambiences, voices in dreams, transitions with movement.",
    tags: ["swirl", "sci-fi", "movement"],
    params: [
      { type: "number", id: "speed", label: "Speed", min: 0.1, max: 2, default: 0.5, step: 0.05, unit: "Hz" },
      { type: "number", id: "decay", label: "Intensity", min: 0, max: 0.99, default: 0.6, step: 0.01 },
    ],
    build: (p, ctx) => {
      const decay = num(p, "decay");
      const gain = Math.min(0.9, (1 - decay) / 0.6);
      return chain(ctx.input, ctx.output, [
        `aphaser=in_gain=0.6:out_gain=${n(gain, 6)}:delay=3:decay=${n(decay)}:speed=${n(num(p, "speed"))}:type=t`,
      ]);
    },
  },
  {
    id: "tremolo",
    name: "Tremolo",
    category: "modulation",
    description: "Oscillates the volume periodically.",
    whenToUse: "Helicopters, fans, flickering lights, surf guitars, pulsing tension.",
    tags: ["pulse", "volume", "helicopter", "flicker"],
    params: [
      { type: "number", id: "speed", label: "Speed", min: 0.5, max: 30, default: 6, step: 0.1, unit: "Hz" },
      { type: "number", id: "depth", label: "Depth", min: 0, max: 1, default: 0.6, step: 0.01 },
    ],
    build: (p, ctx) => chain(ctx.input, ctx.output, [`tremolo=f=${n(num(p, "speed"))}:d=${n(num(p, "depth"))}`]),
  },
  {
    id: "vibrato",
    name: "Vibrato",
    category: "modulation",
    description: "Oscillates the pitch periodically.",
    whenToUse: "Dizziness, drunkenness, melting tape, voices trembling with fear.",
    tags: ["dizzy", "wobbly", "pitch", "drunk"],
    params: [
      { type: "number", id: "speed", label: "Speed", min: 0.1, max: 12, default: 5, step: 0.1, unit: "Hz" },
      { type: "number", id: "depth", label: "Depth", min: 0, max: 1, default: 0.3, step: 0.01 },
    ],
    build: (p, ctx) => chain(ctx.input, ctx.output, [vibrato(num(p, "speed"), num(p, "depth"))]),
  },
  {
    id: "pitch",
    name: "Pitch shift",
    category: "character",
    description: "Raises or lowers the pitch without changing the duration (rubberband).",
    whenToUse: "Chipmunk or monster voices, anonymizing someone, tuning an effect to fit the music.",
    tags: ["pitch", "tone", "high", "low", "anonymize"],
    params: [
      { type: "number", id: "semitones", label: "Semitones", min: -24, max: 24, default: -5, step: 0.5, unit: "st" },
      { type: "bool", id: "formant", label: "Preserve formants", default: false, description: "Keeps the human timbre when shifting pitch." },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `rubberband=pitch=${n(pitchRatio(num(p, "semitones")), 6)}:formant=${p.formant ? "preserved" : "shifted"}:pitchq=quality`,
      ]),
  },
  {
    id: "robot",
    name: "Robot",
    category: "character",
    description: "Ring modulation with a metallic, digital touch.",
    whenToUse: "Androids, AI, system voices, synthetic alarms or a tech villain.",
    tags: ["robot", "ai", "android", "metallic", "synthetic"],
    params: [
      { type: "number", id: "freq", label: "Frequency", min: 20, max: 400, default: 60, unit: "Hz", scale: "log" },
      { type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 0.8, step: 0.01 },
    ],
    build: (p, ctx) => {
      const m = num(p, "mix");
      const w = `2*PI*${n(num(p, "freq"))}*t`;
      const modulated = ctx.label("rmod");
      const echo = ctx.label("re");
      return [
        chain(ctx.input, modulated, [`aeval=val(ch)*(${n(1 - m)}+${n(m)}*sin(${w})):c=same`]),
        delayMix({ ...ctx, input: modulated, output: echo }, 1, [{ ms: 6, gain: 0.4 }, { ms: 11, gain: 0.3 }]),
        chain(echo, ctx.output, ["acrusher=bits=12:mode=lin:mix=0.5", "volume=3dB", peakLimiter()]),
      ].join(";");
    },
  },
  {
    id: "monster",
    name: "Monster",
    category: "character",
    description: "A deep, saturated voice with body.",
    whenToUse: "Creatures, demons, a threatening character, horror comedy.",
    tags: ["monster", "demon", "deep", "horror"],
    params: [{ type: "number", id: "semitones", label: "Semitones", min: -18, max: -3, default: -8, step: 0.5, unit: "st" }],
    build: (p, ctx) => {
      const saturated = ctx.label("ms");
      const echo = ctx.label("me");
      return [
        chain(ctx.input, saturated, [
          `rubberband=pitch=${n(pitchRatio(num(p, "semitones")), 6)}:formant=shifted`,
          "bass=g=6:f=110",
          "volume=2dB",
          "asoftclip=type=tanh",
        ]),
        delayMix({ ...ctx, input: saturated, output: echo }, 1, [{ ms: 12, gain: 0.3 }, { ms: 25, gain: 0.2 }]),
        chain(echo, ctx.output, [peakLimiter()]),
      ].join(";");
    },
  },
  {
    id: "ghost",
    name: "Ghost",
    category: "character",
    description: "An ethereal voice: lower, widened, with a long reverb and no body.",
    whenToUse: "Apparitions, voices from beyond, whispers in a character's head, atmospheric horror.",
    tags: ["ghost", "horror", "ethereal", "whisper", "beyond"],
    hasTail: true,
    params: [{ type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 0.6, step: 0.01 }],
    build: (p, ctx) => {
      const mid = ctx.label("gh");
      const doubled = ctx.label("ghc");
      const widened = ctx.label("ghw");
      return [
        chain(ctx.input, mid, [
          "rubberband=pitch=0.89:formant=preserved",
          "highpass=f=250",
        ]),
        chorus({ ...ctx, input: mid, output: doubled }, 0.63, [
          { speed: 0.2, depth: 2, gain: 0.36 },
          { speed: 0.3, depth: 2.5, gain: 0.315 },
          { speed: 0.4, depth: 3, gain: 0.27 },
        ]),
        chain(doubled, widened, [
          "flanger=delay=2:depth=3:regen=20:speed=0.2",
          "volume=5dB",
        ]),
        convolutionReverb(ctx, widened, ctx.output, { decay: 4.5, damping: 4000, predelayMs: 30, lowcut: 300, mix: num(p, "mix") }),
      ].join(";");
    },
  },
];
