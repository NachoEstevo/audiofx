import { DECAY_FOR_RT60, chain, convolutionReverb, n, slope, vibrato } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;

/** Speed of sound in air at 20 °C, m/s. */
const SPEED_OF_SOUND = 343;
/**
 * rubberband applies a new pitch to the audio it already holds, so a change is heard early: 33–55 ms with
 * window=short and 256-sample frames (measured; 54–116 ms with the default window). Pitch commands go out this late.
 */
const PITCH_LEAD = 0.042;
/**
 * Pitch automation resolution, at or below the smallest audible pitch step. Each command leaves a faint transient
 * (measured on a gliding 1 kHz tone: energy above 5 kHz -62 dB with 10-cent steps, -56 dB with 2-cent steps).
 */
const PITCH_STEP_CENTS = 5;
const MAX_PITCH_COMMANDS = 300;

/** A source moving in a straight line at `v` m/s that is closest (`d` m) to the listener at `at` seconds. */
interface PassBy {
  at: number;
  v: number;
  d: number;
}
/** Position along the path (negative while approaching) and distance to the listener. */
const along = (p: PassBy, t: number) => p.v * (t - p.at);
const distanceAt = (p: PassBy, t: number) => Math.hypot(p.d, along(p, t));
/** Doppler ratio c / (c − v·cosθ), where cosθ = −x/R is the share of the speed that points at the listener. */
const dopplerRatio = (p: PassBy, t: number) => SPEED_OF_SOUND / (SPEED_OF_SOUND + (p.v * along(p, t)) / distanceAt(p, t));
const cents = (ratio: number) => 1200 * Math.log2(ratio);
/** Lowpass cutoff for air absorption: open at the closest point, closing with distance (exaggerated at air = 1). */
const airCutoff = (p: PassBy, t: number, air: number) => Math.max(800, 20000 * Math.pow(p.d / distanceAt(p, t), 1.5 * air));

/**
 * asendcmd automation for the pass: rubberband pitch every PITCH_STEP_CENTS (sent PITCH_LEAD late) and the air
 * lowpass every 3% of cutoff. Far from the pass both settle (x/R → ±1), so the commands cover 40 closest
 * distances on each side of `at`. The curve is sampled 200 times per d/v (its time constant): 2 ms by default.
 */
function passByCommands(p: PassBy, pitchTarget: string, air: { target: string; amount: number } | null) {
  const span = (40 * p.d) / p.v;
  const dt = p.d / p.v / 200;
  const t0 = Math.max(0, p.at - span);
  const t1 = p.at + span;
  const glide = Math.abs(cents(dopplerRatio(p, t0) / dopplerRatio(p, t1)));
  const step = Math.max(PITCH_STEP_CENTS, glide / MAX_PITCH_COMMANDS);
  const pitch: string[] = [];
  const lowpass: string[] = [];
  let lastCents = cents(dopplerRatio(p, 0));
  let lastCutoff = air ? airCutoff(p, 0, air.amount) : 0;
  for (let t = t0; t <= t1; t += dt) {
    const r = dopplerRatio(p, t);
    if (Math.abs(cents(r) - lastCents) >= step) {
      pitch.push(`${n(t + PITCH_LEAD)} ${pitchTarget} pitch ${n(r, 6)}`);
      lastCents = cents(r);
    }
    if (air) {
      const f = airCutoff(p, t, air.amount);
      if (Math.abs(Math.log(f / lastCutoff)) >= 0.03) {
        lowpass.push(`${n(t)} ${air.target} f ${n(f, 0)}`);
        lastCutoff = f;
      }
    }
  }
  return { pitch, lowpass };
}

/** Preset spaces: decay as RT60 in seconds (the time to fall 60 dB, as rooms are measured), high damping (Hz), pre-delay (ms). */
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
        decay: s.decay * num(p, "size") * DECAY_FOR_RT60,
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
    id: "doppler",
    name: "Pass-by (Doppler)",
    category: "space",
    description:
      "A source passing the camera: pitch above normal while it approaches and below as it leaves (the physical Doppler curve), level peaking at the pass, a pan across the field and duller sound far away. Keeps the duration.",
    whenToUse:
      "A car, motorbike, train, plane or drone going past. Apply it to the isolated sound, usually a sample that then gets layered (a car sample rendered through doppler, then mixed in with layer), not to a whole mix: it bends the pitch of everything.",
    tags: ["doppler", "pass-by", "fly-by", "car", "plane", "movement", "pitch", "pan"],
    timed: true,
    params: [
      {
        type: "number",
        id: "at",
        label: "Closest at",
        min: 0,
        max: 600,
        default: 2,
        unit: "s",
        step: 0.01,
        description: "Second when the source is closest to the camera. In the studio it comes from the moment marker.",
      },
      { type: "number", id: "speed", label: "Speed", min: 10, max: 600, default: 90, unit: "km/h", step: 5, description: "Faster = a bigger pitch drop (about 2.5 semitones at 90 km/h)." },
      {
        type: "number",
        id: "distance",
        label: "Closest distance",
        min: 1,
        max: 300,
        default: 10,
        unit: "m",
        scale: "log",
        description: "Closer = a more sudden pitch glide and a sharper level peak; farther = a slow, gentle pass.",
      },
      { type: "enum", id: "direction", label: "Direction", options: ["left-right", "right-left", "center"], default: "left-right", description: "center keeps the stereo image (a pass overhead or straight through)." },
      { type: "number", id: "falloff", label: "Level falloff", min: 0, max: 1, default: 1, step: 0.01, description: "How much the level follows the distance: 1 = physical (-6 dB per doubling), 0 = constant level." },
      { type: "number", id: "air", label: "Air", min: 0, max: 1, default: 0.5, step: 0.01, description: "Dulls the sound far away (air absorption, exaggerated at 1). 0 = off." },
    ],
    build: (p, ctx) => {
      const pass: PassBy = { at: num(p, "at"), v: num(p, "speed") / 3.6, d: num(p, "distance") };
      const rb = `rubberband@${ctx.label("dp")}`;
      const lp = `lowpass@${ctx.label("dpa")}`;
      const air = num(p, "air");
      const cmds = passByCommands(pass, rb, air > 0 ? { target: lp, amount: air } : null);
      // Level (1/R law, at most -40 dB) and pan, per sample: x along the path, R distance, x/R from -1 to 1.
      const at = n(pass.at);
      const x = `${n(pass.v)}*(t-${at})`;
      const gain = `max(0.01,pow(${n(pass.d)}/hypot(${n(pass.d)},${x}),${n(num(p, "falloff"))}))`;
      const side = p.direction === "right-left" ? "-1" : "1";
      const angle = `(1+${side}*(${x})/hypot(${n(pass.d)},${x}))*PI/4`;
      // Equal-power pan of the mono sum, scaled so the center (the pass) keeps the source level.
      const level =
        p.direction === "center"
          ? `aeval='val(0)*${gain}|val(1)*${gain}':c=same`
          : `aeval='(val(0)+val(1))*0.7071*${gain}*cos(${angle})|(val(0)+val(1))*0.7071*${gain}*sin(${angle})':c=same`;
      const dry = ctx.label("dpd");
      const wet = ctx.label("dpw");
      const silent = ctx.label("dps");
      const out = ctx.label("dpo");
      return [
        `[${ctx.input}]asplit=2[${dry}][${wet}]`,
        chain(wet, out, [
          // Short frames so asendcmd applies each command on time (5 ms at 48 kHz).
          "asetnsamples=n=256",
          ...(cmds.pitch.length ? [`asendcmd=c='${cmds.pitch.join(";")}'`] : []),
          // consistency = rubberband's mode for pitch that changes while playing (quality jumps when crossing 1.0).
          `${rb}=pitch=${n(dopplerRatio(pass, 0), 6)}:pitchq=consistency:window=short`,
          "asetnsamples=n=256",
          ...(cmds.lowpass.length ? [`asendcmd=c='${cmds.lowpass.join(";")}'`] : []),
          ...(air > 0 ? [`${lp}=f=${n(airCutoff(pass, 0, air), 0)}`] : []),
          level,
        ]),
        // rubberband flushes a few extra ms at the end: a silent copy of the input sets the exact length.
        `[${dry}]volume=0[${silent}]`,
        `[${silent}][${out}]amix=inputs=2:duration=first:normalize=0[${ctx.output}]`,
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
        // The resonance and the make-up gain push a full-scale master a few dB over: hold it, or it crackles.
        "alimiter=limit=0.891:attack=5:release=50:level=0:latency=1",
      ]);
    },
  },
];
