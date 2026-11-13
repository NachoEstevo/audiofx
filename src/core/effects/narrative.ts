import { chain, convolutionReverb, mixInto, n, ramp, slope, vibrato } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;

export const narrativeEffects: EffectDefinition[] = [
  {
    id: "dream",
    name: "Dream",
    category: "narrative",
    description: "Soft, wide and distant: chorus, light vibrato, rounded highs and a big reverb.",
    whenToUse: "Dream sequences, fantasies, entering a character's imagination, daydreaming moments.",
    tags: ["dream", "fantasy", "dreamy", "ethereal"],
    hasTail: true,
    params: [{ type: "number", id: "amount", label: "Amount", min: 0, max: 1, default: 0.6, step: 0.01 }],
    build: (p, ctx) => {
      const a = num(p, "amount");
      const mid = ctx.label("dr");
      return [
        chain(ctx.input, mid, [
          `lowpass=f=${n(12000 - a * 7000)}`,
          "chorus=0.8:0.9:40|60:0.4|0.3:0.2|0.3:2|2.5",
          vibrato(0.3, 0.1 + a * 0.3),
        ]),
        convolutionReverb(ctx, mid, ctx.output, { decay: 3.5, damping: 5000, predelayMs: 40, lowcut: 200, mix: 0.3 + a * 0.5 }),
      ].join(";");
    },
  },
  {
    id: "flashback",
    name: "Flashback",
    category: "narrative",
    description: "A memory: narrowed band, echo and reverb that detach it from the present.",
    whenToUse: "Memories, voices from the past, testimonies coming back to a character's mind.",
    tags: ["memory", "past", "recollection", "flashback"],
    hasTail: true,
    params: [{ type: "number", id: "amount", label: "Amount", min: 0, max: 1, default: 0.6, step: 0.01 }],
    build: (p, ctx) => {
      const a = num(p, "amount");
      const mid = ctx.label("fb");
      return [
        chain(ctx.input, mid, [
          `highpass=f=${n(120 + a * 200)}`,
          `lowpass=f=${n(9000 - a * 4500)}`,
          `aecho=1:1:180|360:${n(0.25 * a)}|${n(0.12 * a)}`,
        ]),
        convolutionReverb(ctx, mid, ctx.output, { decay: 2.4, damping: 4500, predelayMs: 20, lowcut: 250, mix: 0.2 + a * 0.4 }),
      ].join(";");
    },
  },
  {
    id: "tinnitus",
    name: "Shell shock (post-explosion)",
    category: "narrative",
    description: "The world goes dull and a high ringing stays in the ear.",
    whenToUse:
      "After an explosion or a blow, shock, a panic attack, the war scene where everything goes deaf. Use from/to with a long fade so the sound comes back.",
    tags: ["explosion", "shock", "war", "ringing", "deaf", "panic"],
    params: [
      { type: "number", id: "deafness", label: "Deafness", min: 0, max: 1, default: 0.8, step: 0.01 },
      { type: "number", id: "tone", label: "Ring pitch", min: 2000, max: 12000, default: 6500, unit: "Hz", scale: "log" },
      { type: "number", id: "ring", label: "Ring length", min: 0.5, max: 15, default: 5, unit: "s", step: 0.1 },
      { type: "number", id: "level", label: "Ring level", min: 0, max: 1, default: 0.4, step: 0.01 },
    ],
    build: (p, ctx) => {
      const d = num(p, "deafness");
      const muffled = ctx.label("tm");
      const tone = ctx.label("tt");
      const ring = num(p, "ring");
      return [
        chain(ctx.input, muffled, [
          ...slope(`lowpass=f=${n(2500 * (1 - d) + 220 * d)}`, 36),
          "aecho=0.9:0.7:40|90:0.3|0.2",
          `volume=${n(-6 - d * 10)}dB`,
        ]),
        `sine=f=${n(num(p, "tone"))}:r=48000:d=${n(ring)},volume=${n(0.25 * num(p, "level"))},` +
          `afade=t=in:d=0.05,afade=t=out:st=0.1:d=${n(Math.max(0.2, ring - 0.1))}:curve=exp,aformat=channel_layouts=stereo[${tone}]`,
        mixInto(muffled, tone, ctx.output),
      ].join(";");
    },
  },
  {
    id: "slowmo",
    name: "Slow motion",
    category: "narrative",
    description: "Lowers speed and pitch together, like slower tape. Changes the duration.",
    whenToUse: "Under a slow-motion shot, impact moments, a hit that stretches.",
    tags: ["slow", "slowmo", "impact", "low"],
    changesDuration: true,
    params: [{ type: "number", id: "speed", label: "Speed", min: 0.25, max: 0.95, default: 0.6, step: 0.01, unit: "x" }],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [`asetrate=${n(48000 * num(p, "speed"), 0)}`, "aresample=48000", "lowpass=f=9000"]),
  },
  {
    id: "speedup",
    name: "Speed up",
    category: "narrative",
    description: "Changes speed without changing pitch (or with pitch, if asked). Changes the duration.",
    whenToUse: "Fitting audio to a shorter shot, timelapses, sped-up humor.",
    tags: ["fast", "speed", "timelapse", "fit"],
    changesDuration: true,
    params: [
      { type: "number", id: "speed", label: "Speed", min: 0.5, max: 4, default: 1.5, step: 0.05, unit: "x" },
      { type: "bool", id: "keepPitch", label: "Keep pitch", default: true },
    ],
    build: (p, ctx) =>
      chain(
        ctx.input,
        ctx.output,
        p.keepPitch
          ? [`rubberband=tempo=${n(num(p, "speed"))}`]
          : [`asetrate=${n(48000 * num(p, "speed"), 0)}`, "aresample=48000"],
      ),
  },
];

export const transitionEffects: EffectDefinition[] = [
  {
    id: "filter-sweep",
    name: "Filter sweep",
    category: "transition",
    description: "Opens or closes a low pass (or high pass) over time.",
    whenToUse:
      "Open the music on a drop (200 Hz to 18 kHz), close it when entering a memory, go in and out of the water, or build tension before a cut.",
    tags: ["sweep", "drop", "build-up", "open", "close", "tension"],
    params: [
      { type: "enum", id: "filter", label: "Filter", options: ["lowpass", "highpass"], default: "lowpass" },
      { type: "number", id: "fromFreq", label: "From", min: 30, max: 20000, default: 250, unit: "Hz", scale: "log" },
      { type: "number", id: "toFreq", label: "To", min: 30, max: 20000, default: 18000, unit: "Hz", scale: "log" },
      { type: "number", id: "start", label: "Start", min: 0, max: 600, default: 0, unit: "s", step: 0.05 },
      { type: "number", id: "duration", label: "Duration", min: 0.05, max: 60, default: 3, unit: "s", step: 0.05 },
      { type: "number", id: "q", label: "Resonance (Q)", min: 0.5, max: 10, default: 1.2, step: 0.1 },
    ],
    build: (p, ctx) => {
      const name = `${p.filter}@${ctx.label("sw")}`;
      return chain(ctx.input, ctx.output, [
        ramp(name, "f", {
          start: num(p, "start"),
          duration: num(p, "duration"),
          from: num(p, "fromFreq"),
          to: num(p, "toFreq"),
          curve: "exponential",
        }),
        `${name}=f=${n(num(p, "fromFreq"))}:width_type=q:w=${n(num(p, "q"))}`,
      ]);
    },
  },
  {
    id: "tape-stop",
    name: "Tape stop",
    category: "transition",
    description: "The tape brakes to a halt: pitch and speed fall together. The audio ends there.",
    whenToUse: "Abrupt comedic cuts, a 'wait, what?' record scratch, cutting the music before a dramatic silence.",
    tags: ["cut", "brake", "humor", "stop", "transition"],
    changesDuration: true,
    params: [
      { type: "number", id: "at", label: "Moment", min: 0, max: 600, default: 2, unit: "s", step: 0.05 },
      { type: "number", id: "length", label: "Brake length", min: 0.2, max: 4, default: 1, unit: "s", step: 0.05 },
    ],
    build: (p, ctx) => {
      const at = num(p, "at");
      const L = num(p, "length");
      const steps = Math.max(10, Math.round(L / 0.02));
      const cmds: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const tau = (L * i) / steps; // output time inside the brake
        const rate = Math.max(0.03, 1 - tau / L);
        const inputTime = at + tau - (tau * tau) / (2 * L); // integral of the speed
        cmds.push(`${n(inputTime)} rubberband@ts tempo ${n(rate)}, rubberband@ts pitch ${n(rate)}`);
      }
      return chain(ctx.input, ctx.output, [
        `asendcmd=c='${cmds.join(";")}'`,
        "rubberband@ts=tempo=1:pitch=1",
        `atrim=end=${n(at + L)}`,
        `afade=t=out:st=${n(at + L - 0.08)}:d=0.08`,
      ]);
    },
  },
  {
    id: "reverse",
    name: "Reverse",
    category: "transition",
    description: "Reverses the whole audio.",
    whenToUse: "Supernatural effects, rewinding, 'back in time' transitions, building swells from a hit.",
    tags: ["reverse", "rewind", "invert", "time"],
    changesDuration: true,
    params: [],
    build: (_p, ctx) => chain(ctx.input, ctx.output, ["areverse"]),
  },
  {
    id: "reverse-swell",
    name: "Reverse reverb (swell)",
    category: "transition",
    description: "A reversed reverb tail that grows into the sound. Adds time before the start.",
    whenToUse:
      "A word or hit that enters with an 'inhale' before it, ghostly appearances, horror transitions. The original sound starts 'decay' seconds later.",
    tags: ["swell", "appearance", "horror", "entrance", "transition"],
    changesDuration: true,
    params: [
      { type: "number", id: "decay", label: "Swell length", min: 0.3, max: 6, default: 1.5, unit: "s", step: 0.1 },
      { type: "number", id: "mix", label: "Amount", min: 0.2, max: 1, default: 0.8, step: 0.01 },
    ],
    build: (p, ctx) => {
      const decay = num(p, "decay");
      const a = ctx.label("rs");
      const b = ctx.label("rs");
      return [
        chain(ctx.input, a, ["areverse", `apad=pad_dur=${n(decay)}`]),
        convolutionReverb(ctx, a, b, { decay, damping: 5000, predelayMs: 0, lowcut: 200, mix: num(p, "mix") }),
        chain(b, ctx.output, ["areverse"]),
      ].join(";");
    },
  },
];
