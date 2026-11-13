import { chain, n, slope } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;
const lin = (db: number) => n(Math.pow(10, db / 20), 6);

export const dynamicsEffects: EffectDefinition[] = [
  {
    id: "voice-clean",
    name: "Clean voice",
    category: "dynamics",
    description: "A typical voice chain: high pass, de-esser, presence and compression.",
    whenToUse: "Narration, interviews and voice-overs before mixing them with music. It is the first step for almost any voice.",
    tags: ["voice", "narration", "cleanup", "podcast", "voice-over"],
    params: [
      { type: "number", id: "lowcut", label: "Low cut", min: 40, max: 200, default: 90, unit: "Hz" },
      { type: "number", id: "presence", label: "Presence", min: 0, max: 8, default: 2.5, unit: "dB", step: 0.5 },
      { type: "number", id: "compression", label: "Compression", min: 0, max: 1, default: 0.5, step: 0.01 },
      { type: "number", id: "deess", label: "De-esser", min: 0, max: 1, default: 0.3, step: 0.01 },
    ],
    build: (p, ctx) => {
      const c = num(p, "compression");
      return chain(ctx.input, ctx.output, [
        ...slope(`highpass=f=${n(num(p, "lowcut"))}`, 24),
        "equalizer=f=300:t=q:w=1:g=-2",
        `equalizer=f=3500:t=q:w=1.2:g=${n(num(p, "presence"))}`,
        num(p, "deess") > 0 ? `deesser=i=${n(num(p, "deess"))}` : "anull",
        `acompressor=threshold=${n(-12 - c * 14)}dB:ratio=${n(2 + c * 4)}:attack=8:release=120:makeup=${n(2 + c * 6)}dB`,
      ]);
    },
  },
  {
    id: "compressor",
    name: "Compressor",
    category: "dynamics",
    description: "Reduces the difference between loud and soft parts.",
    whenToUse: "To keep a voice even and intelligible, give hits punch, or settle a piece of music.",
    tags: ["compression", "dynamics", "even", "punch"],
    params: [
      { type: "number", id: "threshold", label: "Threshold", min: -60, max: 0, default: -20, unit: "dB" },
      { type: "number", id: "ratio", label: "Ratio", min: 1, max: 20, default: 4, step: 0.5 },
      { type: "number", id: "attack", label: "Attack", min: 0.1, max: 200, default: 10, unit: "ms" },
      { type: "number", id: "release", label: "Release", min: 10, max: 2000, default: 150, unit: "ms" },
      { type: "number", id: "makeup", label: "Makeup", min: 0, max: 24, default: 4, unit: "dB", step: 0.5 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `acompressor=threshold=${n(num(p, "threshold"))}dB:ratio=${n(num(p, "ratio"))}:attack=${n(num(p, "attack"))}:release=${n(num(p, "release"))}:makeup=${n(num(p, "makeup"))}dB`,
      ]),
  },
  {
    id: "limiter",
    name: "Limiter",
    category: "dynamics",
    description: "Keeps the level under a ceiling; with Drive it also raises it, like a maximizer. Compensates latency.",
    whenToUse: "At the end of a chain to avoid clipping (the default), or with Drive to make a hit or music louder and denser.",
    tags: ["limiter", "ceiling", "clipping", "master"],
    params: [
      { type: "number", id: "drive", label: "Drive", min: 0, max: 24, default: 0, unit: "dB", step: 0.5, description: "Gain before the limiter. 0 = a safety ceiling that only catches overs; more drive = louder and more squashed." },
      { type: "number", id: "ceiling", label: "Ceiling", min: -12, max: 0, default: -1, unit: "dB", step: 0.1 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `volume=${n(num(p, "drive"))}dB`,
        `alimiter=limit=${lin(num(p, "ceiling"))}:attack=5:release=50:level=0:latency=1`,
      ]),
  },
  {
    id: "gate",
    name: "Gate",
    category: "dynamics",
    description: "Silences what falls below the threshold (background noise between phrases). If the source has no noise between phrases, nothing changes.",
    whenToUse: "Clean hum or room tone between phrases of a voice recorded at home, or trim the tails of hits.",
    tags: ["gate", "noise", "cleanup", "silence"],
    params: [
      { type: "number", id: "threshold", label: "Threshold", min: -70, max: -10, default: -40, unit: "dB" },
      { type: "number", id: "release", label: "Release", min: 10, max: 1000, default: 200, unit: "ms" },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `agate=threshold=${lin(num(p, "threshold"))}:ratio=10:attack=2:release=${n(num(p, "release"))}:range=0.01`,
      ]),
  },
  {
    id: "loudness",
    name: "Loudness normalize",
    category: "dynamics",
    description: "Sets the perceived volume to a LUFS target (EBU R128) with a true-peak ceiling.",
    whenToUse:
      "On export: -14 LUFS for YouTube, Instagram and TikTok, -16 for podcasts, -23 for broadcast. Also to match clips from different sources.",
    tags: ["loudness", "lufs", "volume", "master", "export"],
    params: [
      { type: "number", id: "target", label: "Target", min: -30, max: -8, default: -14, unit: "LUFS", step: 0.5 },
      { type: "number", id: "truePeak", label: "True peak", min: -6, max: 0, default: -1, unit: "dBTP", step: 0.1 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [`loudnorm=I=${n(num(p, "target"))}:TP=${n(num(p, "truePeak"))}:LRA=11`, "aresample=48000"]),
  },
  {
    id: "fade",
    name: "Fade in / out",
    category: "dynamics",
    description: "Fade in and fade out. The fade out does not need to know the duration.",
    whenToUse: "Start and end of music, soft ambience entrances, avoiding clicks at cuts.",
    tags: ["fade", "fade in", "fade out", "entrance"],
    params: [
      { type: "number", id: "in", label: "Fade in", min: 0, max: 30, default: 0.5, unit: "s", step: 0.05 },
      { type: "number", id: "out", label: "Fade out", min: 0, max: 30, default: 1.5, unit: "s", step: 0.05 },
      { type: "enum", id: "curve", label: "Curve", options: ["tri", "qsin", "exp", "log"], default: "qsin" },
    ],
    build: (p, ctx) => {
      const filters: string[] = [];
      if (num(p, "in") > 0) filters.push(`afade=t=in:d=${n(num(p, "in"))}:curve=${p.curve}`);
      if (num(p, "out") > 0) filters.push("areverse", `afade=t=in:d=${n(num(p, "out"))}:curve=${p.curve}`, "areverse");
      return chain(ctx.input, ctx.output, filters);
    },
  },
  {
    id: "gain",
    name: "Gain",
    category: "dynamics",
    description: "Raises or lowers the level in dB.",
    whenToUse: "Simple level adjustments inside a chain.",
    tags: ["volume", "level", "gain"],
    params: [{ type: "number", id: "db", label: "Gain", min: -48, max: 24, default: -6, unit: "dB", step: 0.5 }],
    build: (p, ctx) => chain(ctx.input, ctx.output, [`volume=${n(num(p, "db"))}dB`]),
  },
  {
    id: "stereo-width",
    name: "Stereo width",
    category: "dynamics",
    description: "Widens the stereo image, even of mono sources (delayed side injection, mono-compatible). 0 = mono.",
    whenToUse: "Open up music or an ambience to leave room for the voice in the center, widen a mono effect, or fold something to mono.",
    tags: ["stereo", "wide", "mono", "image", "haas"],
    params: [{ type: "number", id: "width", label: "Width", min: 0, max: 2, default: 1.5, step: 0.05, description: "1 = unchanged, 0 = mono, 2 = very wide." }],
    build: (p, ctx) => {
      const w = num(p, "width");
      if (w <= 1) return chain(ctx.input, ctx.output, [`extrastereo=m=${n(w)}:c=0`]);
      // Synthetic side: the mid delayed 13 ms, without lows, with opposite polarity in each channel.
      // When summed to mono the side cancels out: no comb filtering on mono playback.
      const a = ctx.label("wa");
      const b = ctx.label("wb");
      const side = ctx.label("ws");
      return [
        `[${ctx.input}]asplit=2[${a}][${b}]`,
        `[${b}]pan=mono|c0=0.5*c0+0.5*c1,adelay=delays=13:all=1,highpass=f=250,volume=${n((w - 1) * 0.9)},pan=stereo|c0=c0|c1=-1*c0[${side}]`,
        `[${a}]extrastereo=m=${n(w)}:c=0[${a}x]`,
        `[${a}x][${side}]amix=inputs=2:duration=first:normalize=0[${ctx.output}]`,
      ].join(";");
    },
  },
];
