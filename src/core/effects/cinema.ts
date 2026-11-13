import { bandLimit, chain, convolutionReverb, drive, mixInto, n, noiseSource, noises, rampCommands, wobble, withNoise } from "../graph.js";
import { SAMPLE_RATE, type BuildContext, type EffectDefinition, type NumberParam, type Params } from "../types.js";

/**
 * Cinema and trailer tools. Unlike a filter, most of them happen at a moment (`at`): a hit on the cut,
 * a riser that ends right there, the gap before the hit, the tail when the music stops. The elements
 * (hit, riser, whoosh, sub drop, braam) are synthesized inside the same filtergraph and added to the
 * signal, the same way layers are stacked from a trailer library.
 */

const num = (p: Params, k: string) => p[k] as number;

const at = (fallback: number, label = "Moment"): NumberParam => ({
  type: "number",
  id: "at",
  label,
  min: 0,
  max: 600,
  default: fallback,
  unit: "s",
  step: 0.01,
  description: "Second of the audio where it happens. In the studio it comes from the moment marker.",
});
const level = (fallback = 0): NumberParam => ({
  type: "number",
  id: "level",
  label: "Level",
  min: -40,
  max: 6,
  default: fallback,
  unit: "dB",
  step: 0.5,
});

/** Adds a generated layer (that starts at 0) to the signal, shifted to `start` seconds. */
function layer(ctx: BuildContext, source: string, start: number, gainDb: number): string {
  const placed = ctx.label("lay");
  return [
    chain(source, placed, [`volume=${n(gainDb)}dB`, `adelay=delays=${n(Math.max(0, start) * 1000, 1)}:all=1`]),
    mixInto(ctx.input, placed, ctx.output),
  ].join(";");
}

/** Sums labeled sources into one, without normalizing. */
function sum(inputs: string[], out: string, weights?: number[]): string {
  const w = weights ? `:weights=${weights.map((x) => n(x)).join(" ")}` : "";
  return `${inputs.map((i) => `[${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0${w}[${out}]`;
}

/** Oscillator with an exponential sweep from f1 to f0 (constant k): integrated phase, no clicks. */
const chirp = (f0: number, df: number, k: number) => `sin(2*PI*(${n(f0)}*t+${n(df / k, 5)}*(1-exp(-${n(k)}*t))))`;

/** Approximate sawtooth with `harmonics` harmonics. */
const saw = (f: number, harmonics: number) =>
  Array.from({ length: harmonics }, (_, i) => `${n(1 / (i + 1), 4)}*sin(2*PI*${n(f * (i + 1), 3)}*t)`).join("+");

/** Send envelope: 1 inside [a, b] with short ramps. */
const gate = (a: number, b: number, fade = 0.02) => `volume='clip((t-${n(a)})/${n(fade)},0,1)*clip((${n(b)}-t)/${n(fade)},0,1)':eval=frame`;

const TONES = {
  dark: { body: 450, crackLow: 1200, crackHigh: 5000, damping: 2500 },
  mid: { body: 1100, crackLow: 2200, crackHigh: 10000, damping: 4500 },
  bright: { body: 2600, crackLow: 3500, crackHigh: 15000, damping: 8000 },
} as const;

export const cinemaEffects: EffectDefinition[] = [
  {
    id: "hit",
    name: "Hit (impact)",
    category: "cinema",
    description: "A trailer impact at a moment: a sub that falls in pitch, body, a crack and a big-room tail.",
    whenToUse:
      "On a cut, a big word landing, the logo, the product reveal or the drop. Pair it with a riser (before) and drop-gap so the hit lands harder.",
    tags: ["hit", "impact", "boom", "cut", "trailer", "logo", "drop"],
    timed: true,
    hasTail: true,
    params: [
      at(2),
      { type: "number", id: "size", label: "Size", min: 0, max: 1, default: 0.6, step: 0.01, description: "Bigger = more sub and a longer tail." },
      { type: "enum", id: "tone", label: "Color", options: ["dark", "mid", "bright"], default: "mid" },
      level(),
    ],
    build: (p, ctx) => {
      const s = num(p, "size");
      const tone = TONES[p.tone as keyof typeof TONES];
      const D = 1.2 + 3.5 * s;
      const [sub, body, crack, raw, verb, punch] = ["hsub", "hbody", "hcrk", "hraw", "hverb", "hpun"].map(ctx.label);
      const subDecay = 2.2 / (0.45 + s);
      return [
        `aevalsrc='0.85*min(1,t*400)*exp(-t*${n(subDecay)})*${chirp(36 + 6 * (1 - s), 95, 15)}':s=${SAMPLE_RATE}:c=stereo:d=${n(D)}[${sub}]`,
        noiseSource(ctx, body, {
          color: "white",
          amplitude: 0.9,
          duration: D,
          filters: [`lowpass=f=${tone.body}`, `lowpass=f=${tone.body}`, `afade=t=out:st=0:d=${n(0.18 + 0.5 * s)}:curve=exp`],
        }),
        noiseSource({ ...ctx, seed: ctx.seed + 5 }, crack, {
          color: "white",
          amplitude: 0.7,
          duration: D,
          filters: [`highpass=f=${tone.crackLow}`, `lowpass=f=${tone.crackHigh}`, `afade=t=out:st=0:d=${n(0.04 + 0.06 * s)}:curve=exp`],
        }),
        sum([sub, body, crack], raw, [1, 0.8, 0.55]),
        convolutionReverb({ ...ctx, seed: ctx.seed + 9 }, raw, verb, {
          decay: 1.2 + 3 * s,
          damping: tone.damping,
          predelayMs: 12,
          mix: 0.35 + 0.45 * s,
          lowcut: 180,
        }),
        chain(verb, punch, drive(5)),
        layer(ctx, punch, num(p, "at"), num(p, "level") - 2),
      ].join(";");
    },
  },
  {
    id: "riser",
    name: "Riser",
    category: "cinema",
    description: "A tension build that stops dead at the given moment: noise that opens up and tones that rise an octave.",
    whenToUse:
      "Before a hit, a drop or the product reveal. End it on the same `at` as the hit. 2–4 s for a cut; 6–10 s for a trailer build-up.",
    tags: ["riser", "build", "tension", "build-up", "before the hit", "trailer"],
    timed: true,
    hasTail: true,
    params: [
      at(3, "Ends at"),
      { type: "number", id: "length", label: "Length", min: 0.5, max: 10, default: 2.5, unit: "s", step: 0.1 },
      { type: "number", id: "tonal", label: "Tones", min: 0, max: 1, default: 0.6, step: 0.01, description: "0 = noise only; 1 = more rising harmony." },
      level(),
    ],
    build: (p, ctx) => {
      const end = num(p, "at");
      const start = Math.max(0, end - num(p, "length"));
      const L = Math.max(0.2, end - start);
      const [noise, tones, raw, verb, out] = ["rn", "rt", "rr", "rv", "ro"].map(ctx.label);
      const bp = `bandpass@${ctx.label("rbp")}`;
      const cmds = rampCommands(bp, "f", { start: 0, duration: L, from: 280, to: 9000, curve: "exponential" });
      const shepard = [110, 164.81, 220, 329.63]
        .map((f) => `sin(2*PI*${n((f * L) / Math.LN2, 3)}*(pow(2,t/${n(L)})-1))`)
        .join("+");
      return [
        noiseSource(ctx, noise, {
          color: "white",
          amplitude: 0.55,
          duration: L,
          filters: [`asendcmd=c='${cmds.join(";")}'`, `${bp}=f=280:width_type=q:w=1.2`, `volume='pow(t/${n(L)},2.2)':eval=frame`],
        }),
        `aevalsrc='${n(0.09 * num(p, "tonal"), 4)}*pow(t/${n(L)},1.8)*(${shepard})':s=${SAMPLE_RATE}:c=stereo:d=${n(L)}[${tones}]`,
        sum([noise, tones], raw),
        convolutionReverb(ctx, raw, verb, { decay: 1.4, damping: 7000, predelayMs: 0, mix: 0.35, lowcut: 250 }),
        // A dead stop at the end (the "choke" that leaves room for the hit).
        chain(verb, out, [`afade=t=out:st=${n(Math.max(0, L - 0.012))}:d=0.012`, `atrim=end=${n(L)}`, "volume=3dB"]),
        layer(ctx, out, start, num(p, "level")),
      ].join(";");
    },
  },
  {
    id: "whoosh",
    name: "Whoosh",
    category: "cinema",
    description: "A fast pass of air that crosses the stereo field, peaking at the given moment.",
    whenToUse: "Shot transitions, text or cards flying in or out, screen changes in a product demo, swipes and zooms.",
    tags: ["whoosh", "swoosh", "transition", "text", "swipe", "zoom", "pass-by"],
    timed: true,
    hasTail: true,
    params: [
      at(1.5, "Peak at"),
      { type: "number", id: "length", label: "Length", min: 0.2, max: 3, default: 0.9, unit: "s", step: 0.05 },
      { type: "enum", id: "direction", label: "Direction", options: ["left-right", "right-left", "center"], default: "left-right" },
      level(),
    ],
    build: (p, ctx) => {
      const L = num(p, "length");
      const start = Math.max(0, num(p, "at") - L / 2);
      const [air, body, mono, panned, verb] = ["wa", "wb", "wm", "wp", "wv"].map(ctx.label);
      const bp = `bandpass@${ctx.label("wbp")}`;
      const cmds = [
        ...rampCommands(bp, "f", { start: 0, duration: L * 0.5, from: 380, to: 3200, curve: "exponential", steps: 30 }),
        ...rampCommands(bp, "f", { start: L * 0.5, duration: L * 0.5, from: 3200, to: 500, curve: "exponential", steps: 30 }),
      ];
      // Envelope with a slower attack than release, like an object passing close by.
      const env = `pow(sin(PI*pow(clip(t/${n(L)},0,1),0.8)),2)`;
      const dir = p.direction as string;
      const pos = dir === "center" ? "0.5" : dir === "left-right" ? `clip(t/${n(L)},0,1)` : `1-clip(t/${n(L)},0,1)`;
      return [
        `anoisesrc=r=${SAMPLE_RATE}:a=0.6:c=pink:d=${n(L)}:seed=${ctx.seed},asendcmd=c='${cmds.join(";")}',${bp}=f=380:width_type=q:w=0.9[${air}]`,
        `anoisesrc=r=${SAMPLE_RATE}:a=0.5:c=brown:d=${n(L)}:seed=${ctx.seed + 3},lowpass=f=320[${body}]`,
        `[${air}][${body}]amix=inputs=2:normalize=0:weights=1 0.6,volume='${env}':eval=frame[${mono}]`,
        `[${mono}]aeval='val(0)*cos(${pos}*PI/2)*1.41|val(0)*sin(${pos}*PI/2)*1.41':c=stereo[${panned}]`,
        convolutionReverb(ctx, panned, verb, { decay: 0.9, damping: 7000, predelayMs: 0, mix: 0.25, lowcut: 300 }),
        layer(ctx, verb, start, num(p, "level") + 6),
      ].join(";");
    },
  },
  {
    id: "sub-drop",
    name: "Sub drop",
    category: "cinema",
    description: "A low tone that falls in pitch and fades slowly: physical weight under a hit or a cut to black.",
    whenToUse: "Under a hit, on a cut to black, when a big title appears or when the music stops suddenly. Felt more than heard.",
    tags: ["sub", "drop", "low", "boom", "black", "title", "weight"],
    timed: true,
    hasTail: true,
    params: [at(2), { type: "number", id: "length", label: "Length", min: 1, max: 6, default: 2.5, unit: "s", step: 0.1 }, level()],
    build: (p, ctx) => {
      const L = num(p, "length");
      const k = 3 / L;
      const raw = ctx.label("sd");
      const env = `min(1,t*300)*exp(-t*${n(1.3 / L)})*min(1,(${n(L)}-t)/0.3)`;
      // The second harmonic makes the drop audible on small speakers too.
      return [
        `aevalsrc='${env}*(0.85*${chirp(28, 50, k)}+0.22*${chirp(56, 100, k)})':s=${SAMPLE_RATE}:c=stereo:d=${n(L)},${drive(3).join(",")}[${raw}]`,
        layer(ctx, raw, num(p, "at"), num(p, "level") - 9),
      ].join(";");
    },
  },
  {
    id: "braam",
    name: "Braam",
    category: "cinema",
    description: "A low blast of saturated brass that opens and fades, the signature of epic trailers.",
    whenToUse: "Reveals, trailer titles, the most dramatic moment of a launch. Use it sparingly: one or two per piece.",
    tags: ["braam", "trailer", "epic", "brass", "title", "reveal"],
    timed: true,
    hasTail: true,
    params: [at(1), { type: "number", id: "length", label: "Length", min: 1.5, max: 8, default: 3.5, unit: "s", step: 0.1 }, level()],
    build: (p, ctx) => {
      const L = num(p, "length");
      const [raw, verb] = ["bm", "bv"].map(ctx.label);
      const lp = `lowpass@${ctx.label("blp")}`;
      const cmds = [
        ...rampCommands(lp, "f", { start: 0, duration: 0.3, from: 180, to: 2400, curve: "exponential", steps: 15 }),
        ...rampCommands(lp, "f", { start: 0.3, duration: Math.max(0.3, L - 0.3), from: 2400, to: 450, curve: "exponential", steps: 40 }),
      ];
      const voices = [43.65, 43.85, 65.41, 87.31].map((f) => `(${saw(f, 7)})`).join("+");
      const env = `min(1,t/0.09)*(0.35+0.65*exp(-t*2.5))*clip((${n(L)}-t)/0.9,0,1)`;
      return [
        `aevalsrc='0.07*${env}*(${voices})':s=${SAMPLE_RATE}:c=stereo:d=${n(L)},asendcmd=c='${cmds.join(";")}',${lp}=f=180,${drive(9).join(",")},` +
          `chorus=0.8:0.9:25|40:0.3|0.25:0.3|0.5:1.5|2[${raw}]`,
        convolutionReverb(ctx, raw, verb, { decay: 3.2, damping: 3500, predelayMs: 20, mix: 0.5, lowcut: 120 }),
        layer(ctx, verb, num(p, "at"), num(p, "level") + 2),
      ].join(";");
    },
  },
  {
    id: "drop-gap",
    name: "Gap before the hit",
    category: "cinema",
    description: "Everything closes down and goes quiet just before, then slams back at the given moment.",
    whenToUse:
      "Half a second before a hit, the music drop or the product reveal: the silence makes the hit land twice as hard. Put it on the same `at` as the hit.",
    tags: ["silence", "gap", "pre-drop", "hit", "suck", "tension", "cut"],
    timed: true,
    params: [
      at(2, "Returns at"),
      { type: "number", id: "gap", label: "Gap length", min: 0.1, max: 2, default: 0.45, unit: "s", step: 0.05 },
      { type: "number", id: "depth", label: "Silence", min: 0, max: 1, default: 1, step: 0.01, description: "1 = total silence; 0 = only the filter closes." },
    ],
    build: (p, ctx) => {
      const back = num(p, "at");
      const gap = num(p, "gap");
      const a = Math.max(0, back - gap);
      const lp = `lowpass@${ctx.label("glp")}`;
      const cmds = [...rampCommands(lp, "f", { start: a, duration: back - a, from: 20000, to: 220, curve: "exponential", steps: 25 }), `${n(back + 0.001)} ${lp} f 20000`];
      return chain(ctx.input, ctx.output, [
        `asendcmd=c='${cmds.join(";")}'`,
        `${lp}=f=20000`,
        // Falls to silence in the first 35% of the gap and stays there until the hit: the "vacuum" that makes it land.
        `volume='if(between(t,${n(a)},${n(back)}),1-${n(num(p, "depth"))}*min(1,pow((t-${n(a)})/${n(Math.max(0.01, (back - a) * 0.35))},1.5)),1)':eval=frame`,
      ]);
    },
  },
  {
    id: "stop-tail",
    name: "Cut with tail",
    category: "cinema",
    description: "The signal cuts dead at the given moment and only the reverb or echo tail of the last sound remains.",
    whenToUse: "Cutting the music to black, the end of a video, the dramatic silence before a key line, a 'stop' on a title.",
    tags: ["cut", "ending", "tail", "stop", "black", "silence", "echo"],
    timed: true,
    hasTail: true,
    params: [
      at(2, "Cuts at"),
      { type: "enum", id: "kind", label: "Tail", options: ["reverb", "echo"], default: "reverb" },
      { type: "number", id: "decay", label: "Tail length", min: 1, max: 8, default: 3.5, unit: "s", step: 0.1 },
    ],
    build: (p, ctx) => {
      const cut = num(p, "at");
      const [dry, send, cutDry, gated, wet, loud] = ["cd", "cs", "cc", "cg", "cw", "cl"].map(ctx.label);
      const tail =
        p.kind === "echo"
          ? chain(gated, wet, [`aecho=0:1:${n(380)}|${n(760)}|${n(1140)}|${n(1520)}:0.65|0.45|0.3|0.18`, "lowpass=f=6000"])
          : // The IR decays exponentially: it is stretched so the perceived tail lasts as long as asked.
            convolutionReverb(ctx, gated, wet, { decay: num(p, "decay") * 1.8, damping: 6000, predelayMs: 0, mix: 1, dry: 0, lowcut: 150 });
      return [
        `[${ctx.input}]asplit=2[${dry}][${send}]`,
        chain(dry, cutDry, [`volume='clip((${n(cut)}-t)/0.015,0,1)':eval=frame`]),
        chain(send, gated, [gate(Math.max(0, cut - 1.2), cut + 0.01, 0.35)]),
        tail,
        // The tail is only heard from the cut on: before it, the dry signal is still playing.
        chain(wet, loud, [`volume='clip((t-${n(cut - 0.03)})/0.03,0,1)*${p.kind === "echo" ? 1.6 : 3.2}':eval=frame`]),
        `[${cutDry}][${loud}]amix=inputs=2:duration=first:normalize=0[${ctx.output}]`,
      ].join(";");
    },
  },
  {
    id: "throw",
    name: "Reverb throw",
    category: "cinema",
    description: "Sends only a short stretch (a word, a hit) to a big reverb or echo; the rest stays dry.",
    whenToUse: "Emphasize the last word of a line, the product name, a 'now' or a drum hit, without washing out the whole voice.",
    tags: ["throw", "word", "reverb", "echo", "tag", "emphasis"],
    timed: true,
    hasTail: true,
    params: [
      at(1, "From"),
      { type: "number", id: "length", label: "Length", min: 0.1, max: 3, default: 0.6, unit: "s", step: 0.05 },
      { type: "enum", id: "kind", label: "Type", options: ["reverb", "echo"], default: "reverb" },
      { type: "number", id: "amount", label: "Amount", min: 0, max: 1, default: 0.7, step: 0.01 },
    ],
    build: (p, ctx) => {
      const a = num(p, "at");
      const [dry, send, gated, wet, loud] = ["td", "ts", "tg", "tw", "tl"].map(ctx.label);
      const tail =
        p.kind === "echo"
          ? chain(gated, wet, ["aecho=0:1:333|666|999|1332:0.6|0.42|0.28|0.16", "highpass=f=250", "lowpass=f=6500"])
          : convolutionReverb(ctx, gated, wet, { decay: 3, damping: 6500, predelayMs: 25, mix: 1, dry: 0, lowcut: 250 });
      return [
        `[${ctx.input}]asplit=2[${dry}][${send}]`,
        chain(send, gated, [gate(a, a + num(p, "length"), 0.03)]),
        tail,
        chain(wet, loud, [`volume=${n(num(p, "amount") * (p.kind === "echo" ? 1.4 : 2.4))}`]),
        `[${dry}][${loud}]amix=inputs=2:duration=first:normalize=0[${ctx.output}]`,
      ].join(";");
    },
  },
  {
    id: "stutter",
    name: "Stutter (glitch)",
    category: "cinema",
    description: "Repeats a short slice several times in a row, like an editing glitch. Lengthens the audio by the repeats.",
    whenToUse: "Big words slamming on screen, fast cuts in a tech demo, a system 'error', comedic tags.",
    tags: ["stutter", "glitch", "repeat", "tech", "edit", "rhythm"],
    timed: true,
    changesDuration: true,
    params: [
      at(1),
      { type: "number", id: "slice", label: "Slice", min: 0.03, max: 0.5, default: 0.12, unit: "s", step: 0.01 },
      { type: "number", id: "repeats", label: "Repeats", min: 2, max: 16, default: 4, step: 1 },
    ],
    build: (p, ctx) => {
      const a = num(p, "at");
      const slice = num(p, "slice");
      const [pa, pb, pc, pre, mid, post] = ["sa", "sb", "sc", "spre", "smid", "spost"].map(ctx.label);
      return [
        `[${ctx.input}]asplit=3[${pa}][${pb}][${pc}]`,
        chain(pa, pre, [`atrim=end=${n(a)}`]),
        chain(pb, mid, [
          `atrim=start=${n(a)}:end=${n(a + slice)}`,
          "asetpts=PTS-STARTPTS",
          "afade=t=in:d=0.004",
          `afade=t=out:st=${n(Math.max(0, slice - 0.006))}:d=0.006`,
          `aloop=loop=${Math.round(num(p, "repeats")) - 1}:size=${Math.round(slice * SAMPLE_RATE)}`,
        ]),
        chain(pc, post, [`atrim=start=${n(a + slice)}`, "asetpts=PTS-STARTPTS"]),
        `[${pre}][${mid}][${post}]concat=n=3:v=0:a=1[${ctx.output}]`,
      ].join(";");
    },
  },
  {
    id: "trailer-voice",
    name: "Trailer voice",
    category: "cinema",
    description: "A deeper voice with chest, compressed and saturated, forward in the mix with a big room behind it.",
    whenToUse: "Trailer or launch narration, the closing claim, 'in a world where...'. Start from a clean, dry voice.",
    tags: ["trailer", "voice", "narrator", "epic", "claim", "voice-over"],
    hasTail: true,
    params: [
      { type: "number", id: "depth", label: "Deeper", min: -6, max: 0, default: -2, unit: "st", step: 0.5 },
      { type: "number", id: "weight", label: "Weight", min: 0, max: 1, default: 0.7, step: 0.01 },
      { type: "number", id: "space", label: "Room", min: 0, max: 1, default: 0.35, step: 0.01 },
    ],
    build: (p, ctx) => {
      const w = num(p, "weight");
      const mid = ctx.label("tv");
      const pitch = Math.pow(2, num(p, "depth") / 12);
      return [
        chain(ctx.input, mid, [
          ...(pitch < 0.999 ? [`rubberband=pitch=${n(pitch, 6)}:formant=preserved:pitchq=quality`] : []),
          "highpass=f=55",
          `equalizer=f=110:t=q:w=0.9:g=${n(2 + 5 * w)}`,
          "equalizer=f=380:t=q:w=1.2:g=-2.5",
          `equalizer=f=3500:t=q:w=1:g=${n(1 + 2.5 * w)}`,
          "acompressor=threshold=0.06:ratio=6:attack=4:release=90:makeup=2",
          ...drive(2 + 5 * w),
          "volume=2.5dB",
        ]),
        convolutionReverb(ctx, mid, ctx.output, { decay: 2.6, damping: 5000, predelayMs: 35, mix: 0.6 * num(p, "space"), lowcut: 300 }),
      ].join(";");
    },
  },
  {
    id: "archival",
    name: "Archival voice",
    category: "cinema",
    description: "An old interview or speech recording: mono, narrowed band, wobbly tape, hiss and a small room.",
    whenToUse: "Archive quotes (an 80s interview, a historic speech), testimonies from the past, period material inside a launch.",
    tags: ["archive", "historic", "interview", "speech", "period", "documentary"],
    params: [
      { type: "number", id: "age", label: "Age", min: 0, max: 1, default: 0.6, step: 0.01 },
      { type: "number", id: "noise", label: "Hiss", min: 0, max: 1, default: 0.4, step: 0.01 },
    ],
    build: (p, ctx) => {
      const a = num(p, "age");
      const roomIn = ctx.label("arr");
      return [
        withNoise(
          { ...ctx, output: roomIn },
          [
            "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
            ...bandLimit(110 + 120 * a, 7500 - 3800 * a, 24),
            `equalizer=f=1400:t=q:w=1:g=${n(2 + 3 * a)}`,
            "acompressor=threshold=0.08:ratio=4:attack=8:release=120:makeup=2",
            ...drive(2 + 4 * a),
            ...wobble(0.25 * a, 0.5 * a),
          ],
          [noises.hiss(num(p, "noise") * 1.4, 1500, 7000)],
        ),
        convolutionReverb(ctx, roomIn, ctx.output, { decay: 0.45, damping: 4000, predelayMs: 5, mix: 0.25, lowcut: 200 }),
      ].join(";");
    },
  },
];
