import { SPEAKERS, chain, drive, dropouts, n, noises, speaker, throughSpeaker, vibrato, withNoise, wobble, type NoiseMaker, type SpeakerModel } from "../graph.js";
import type { EffectDefinition, Params } from "../types.js";

const num = (p: Params, k: string) => p[k] as number;
const MONO = "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1";
const amount = (id: string, label: string, def: number, description?: string) =>
  ({ type: "number", id, label, min: 0, max: 1, default: def, step: 0.01, description }) as const;
const when = (cond: boolean, maker: NoiseMaker): NoiseMaker[] => (cond ? [maker] : []);

/** Phone codec: real resampling to 8 kHz and µ-law quantization, like a landline link. */
const PHONE_CODEC = ["aresample=8000", "acrusher=bits=8:mode=log:aa=1:mix=1", "aresample=48000"];

export const eraEffects: EffectDefinition[] = [
  {
    id: "speaker",
    name: "Speaker",
    category: "era",
    description: "Plays the signal through a device: earpiece, phone, laptop, radio, TV, walkie, megaphone or PA (convolution).",
    whenToUse:
      "Any sound that comes out of a device in the scene: a video on a character's phone, a laptop, the TV in the background, a station loudspeaker. It is the base of the radio, TV and phone effects.",
    tags: ["speaker", "device", "phone", "laptop", "diegetic", "convolution"],
    params: [
      { type: "enum", id: "model", label: "Device", options: Object.keys(SPEAKERS), default: "phone" },
      { type: "number", id: "drive", label: "Saturation", min: 0, max: 18, default: 3, unit: "dB", step: 0.5 },
      { type: "number", id: "mix", label: "Amount", min: 0, max: 1, default: 1, step: 0.01 },
    ],
    build: (p, ctx) => {
      const mid = ctx.label("spk");
      return [
        speaker(ctx, ctx.input, mid, p.model as SpeakerModel, num(p, "mix")),
        chain(mid, ctx.output, drive(num(p, "drive"))),
      ].join(";");
    },
  },
  {
    id: "am-radio",
    name: "AM radio",
    category: "era",
    description: "Transistor radio: small speaker, broadcast compression, saturation and crackling static.",
    whenToUse:
      "Period newscasts, broadcasts in an old car, historic speeches, music playing 'inside' the scene (diegetic) from a radio.",
    tags: ["radio", "retro", "newscast", "vintage", "diegetic"],
    params: [
      { type: "number", id: "drive", label: "Distortion", min: 0, max: 18, default: 6, unit: "dB", step: 0.5 },
      amount("noise", "Static", 0.4),
      amount("drift", "Tuning drift", 0.3, "Slight pitch instability of the station."),
    ],
    build: (p, ctx) =>
      throughSpeaker(
        ctx,
        "radio",
        [MONO, "acompressor=threshold=-26dB:ratio=6:attack=5:release=150:makeup=10dB"],
        [...drive(num(p, "drive")), vibrato(0.21, num(p, "drift") * 0.15), "volume=-3dB"],
        [...when(num(p, "noise") > 0, noises.static(num(p, "noise"))), ...when(num(p, "noise") > 0, noises.hiss(num(p, "noise") * 0.6, 1500, 6000))],
      ),
  },
  {
    id: "old-tv",
    name: "Old TV",
    category: "era",
    description: "Tube TV speaker with a resonant cabinet, mains hum and hiss.",
    whenToUse: "A TV on in the living room, archive footage, old commercials, the voice of a 70s host.",
    tags: ["tv", "television", "retro", "archive", "speaker"],
    params: [
      amount("noise", "Hiss", 0.35),
      amount("hum", "Hum", 0.4),
      { type: "enum", id: "mains", label: "Mains", options: ["50", "60"], default: "50" },
    ],
    build: (p, ctx) =>
      throughSpeaker(
        ctx,
        "tv",
        [MONO, "acompressor=threshold=-20dB:ratio=4:attack=10:release=150:makeup=5dB"],
        [...drive(4), "aecho=1:1:4|9:0.25|0.15", "volume=-6dB"],
        [...when(num(p, "noise") > 0, noises.hiss(num(p, "noise"), 3000, 11000)), ...when(num(p, "hum") > 0, noises.hum(num(p, "hum"), Number(p.mains)))],
      ),
  },
  {
    id: "telephone",
    name: "Landline",
    category: "era",
    description: "A real phone line: 8 kHz band, µ-law quantization and a resonant earpiece.",
    whenToUse: "The other end of a landline call, answering machines, switchboards, period calls.",
    tags: ["telephone", "call", "answering machine", "voice", "landline"],
    params: [amount("noise", "Line noise", 0.15), { type: "number", id: "drive", label: "Saturation", min: 0, max: 12, default: 3, unit: "dB", step: 0.5 }],
    build: (p, ctx) =>
      throughSpeaker(
        ctx,
        "earpiece",
        [MONO, ...PHONE_CODEC, "acompressor=threshold=-22dB:ratio=5:attack=3:release=80:makeup=7dB"],
        [...drive(num(p, "drive")), "volume=-4dB"],
        when(num(p, "noise") > 0, noises.hiss(num(p, "noise"), 300, 3400)),
      ),
  },
  {
    id: "cellphone",
    name: "Bad cell signal",
    category: "era",
    description: "Compressed cell call (narrowband codec) with dropouts, artifacts and a metallic voice.",
    whenToUse: "Cell calls, video calls that freeze, someone talking from a place with no signal, tension in thrillers.",
    tags: ["cellphone", "call", "signal", "dropouts", "glitch", "video call"],
    params: [
      amount("signal", "Bad signal", 0.5, "Higher = more dropouts and artifacts."),
      { type: "number", id: "bits", label: "Codec quality", min: 4, max: 12, default: 7, step: 1, unit: "bits" },
    ],
    build: (p, ctx) => {
      const s = num(p, "signal");
      return throughSpeaker(
        ctx,
        "phone",
        [MONO, "aresample=11025", `acrusher=bits=${n(num(p, "bits"))}:mode=log:aa=0.3:mix=1`, "aresample=48000"],
        ["acompressor=threshold=-20dB:ratio=6:attack=2:release=60:makeup=8dB", dropouts(0.4 + s * 0.6, 1 + s * 3), vibrato(7.3, s * 0.08)],
        [],
      );
    },
  },
  {
    id: "walkie-talkie",
    name: "Walkie-talkie",
    category: "era",
    description: "Handheld radio: very narrow band, hard clipping, extreme compression and static.",
    whenToUse: "Police, military, pilot or tactical comms, or a voice giving orders from afar.",
    tags: ["radio", "police", "military", "pilot", "transmission"],
    params: [
      { type: "number", id: "drive", label: "Distortion", min: 0, max: 24, default: 14, unit: "dB", step: 0.5 },
      amount("noise", "Static", 0.5),
    ],
    build: (p, ctx) =>
      throughSpeaker(
        ctx,
        "walkie",
        [MONO, "acompressor=threshold=-28dB:ratio=12:attack=1:release=50:makeup=12dB"],
        [...drive(num(p, "drive"), "hard"), "acrusher=bits=9:mode=lin:mix=0.5", "volume=-4dB"],
        [...when(num(p, "noise") > 0, noises.static(num(p, "noise") * 1.4)), ...when(num(p, "noise") > 0, noises.hiss(num(p, "noise"), 600, 4000))],
      ),
  },
  {
    id: "megaphone",
    name: "Megaphone",
    category: "era",
    description: "Megaphone horn: horn resonances, aggressive saturation and a metallic bounce.",
    whenToUse: "Protests, station announcements, a coach, a fairground loudspeaker or an alarm voice.",
    tags: ["megaphone", "loudspeaker", "horn", "announcement", "protest"],
    params: [{ type: "number", id: "drive", label: "Distortion", min: 0, max: 24, default: 14, unit: "dB", step: 0.5 }],
    build: (p, ctx) => throughSpeaker(ctx, "megaphone", [MONO, ...drive(num(p, "drive"), "atan")], ["aecho=1:0.9:9|17:0.35|0.2"], []),
  },
  {
    id: "vinyl",
    name: "Vinyl",
    category: "era",
    description: "A vinyl record like iZotope Vinyl: dust, a scratch that repeats every turn, wear, warp and motor rumble.",
    whenToUse: "Archive music, nostalgia, a warm flashback, a scene with a record player.",
    tags: ["vinyl", "record", "nostalgia", "crackle", "retro", "turntable"],
    params: [
      { type: "enum", id: "rpm", label: "RPM", options: ["33", "45", "78"], default: "33" },
      amount("dust", "Dust", 0.5),
      amount("scratch", "Scratch", 0.3),
      amount("wear", "Wear", 0.4, "Loses highs and gains distortion with use."),
      amount("warp", "Warp", 0.3, "Warped record: slow pitch variation."),
      amount("rumble", "Rumble", 0.3),
    ],
    build: (p, ctx) => {
      const rpm = Number(p.rpm);
      const w = num(p, "wear");
      return withNoise(
        ctx,
        [`highpass=f=${n(30 + w * 120)}`, `lowpass=f=${n(17000 - w * 11000)}`, "bass=g=2:f=120", vibrato(rpm / 60, num(p, "warp") * 0.4), ...drive(1 + w * 5)],
        [
          ...when(num(p, "dust") > 0, noises.dust(num(p, "dust"), rpm / 33)),
          ...when(num(p, "dust") > 0, noises.pops(num(p, "dust"))),
          ...when(num(p, "scratch") > 0, noises.scratch(num(p, "scratch"), rpm)),
          ...when(num(p, "rumble") > 0, noises.rumble(num(p, "rumble"))),
          noises.hiss(0.15 + w * 0.35),
        ],
      );
    },
  },
  {
    id: "phonograph",
    name: "Gramophone",
    category: "era",
    description: "A 78 RPM shellac record through an acoustic horn: very narrow band, nasal resonance and dense crackle.",
    whenToUse: "Recordings from 1900–1930, silent film, the distant past or an extreme archive look.",
    tags: ["gramophone", "phonograph", "1920s", "archive", "vintage"],
    params: [amount("crackle", "Crackle", 0.7), amount("noise", "Hiss", 0.5)],
    build: (p, ctx) =>
      throughSpeaker(
        ctx,
        "megaphone",
        [MONO, "highpass=f=350", "lowpass=f=3800", vibrato(1.3, 0.25)],
        [...drive(4), "volume=-1dB"],
        [
          ...when(num(p, "crackle") > 0, noises.dust(num(p, "crackle"), 2.4)),
          ...when(num(p, "crackle") > 0, noises.pops(num(p, "crackle"))),
          ...when(num(p, "crackle") > 0, noises.scratch(num(p, "crackle") * 0.8, 78)),
          ...when(num(p, "noise") > 0, noises.hiss(num(p, "noise") * 1.5, 1000, 5000)),
        ],
      ),
  },
  {
    id: "cassette",
    name: "Cassette",
    category: "era",
    description: "Tape like RC-20: irregular wow and flutter, tape saturation, low boost, level dropouts and hiss.",
    whenToUse: "Home videos from the 80s–90s, mixtapes, VHS, childhood memories, a warm lo-fi look.",
    tags: ["cassette", "tape", "vhs", "80s", "90s", "nostalgia"],
    params: [
      amount("wobble", "Wow & flutter", 0.5),
      amount("saturation", "Saturation", 0.5),
      amount("loss", "Dropouts", 0.3, "Short level drops, like a worn tape."),
      amount("noise", "Hiss", 0.4),
      amount("age", "Age", 0.4, "Fewer highs the more worn it is."),
    ],
    build: (p, ctx) => {
      const age = num(p, "age");
      return withNoise(
        ctx,
        [
          `lowpass=f=${n(15000 - age * 9500)}`,
          "equalizer=f=90:t=q:w=1:g=3",
          ...wobble(num(p, "wobble"), num(p, "wobble")),
          ...drive(2 + num(p, "saturation") * 10),
          dropouts(num(p, "loss") * 0.7, 1),
        ],
        when(num(p, "noise") > 0, noises.hiss(num(p, "noise"), 2500, 12000)),
      );
    },
  },
  {
    id: "lofi",
    name: "Lo-fi",
    category: "era",
    description: "Bit and sample-rate reduction with gentle filtering and some wobble.",
    whenToUse: "A lo-fi look, retro digital content, study beats, or degrading something on purpose.",
    tags: ["lofi", "bitcrush", "degraded", "digital"],
    params: [
      { type: "number", id: "bits", label: "Bits", min: 4, max: 16, default: 8, step: 1 },
      { type: "number", id: "downsample", label: "Downsample", min: 1, max: 16, default: 5, step: 1 },
      { type: "number", id: "tone", label: "Tone", min: 1500, max: 16000, default: 4500, unit: "Hz", scale: "log" },
      amount("wobble", "Wobble", 0.3),
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `acrusher=bits=${n(num(p, "bits"))}:samples=${n(num(p, "downsample"))}:mode=lin:aa=0.3:mix=1`,
        `lowpass=f=${n(num(p, "tone"))}`,
        "bass=g=3:f=90",
        ...wobble(num(p, "wobble"), num(p, "wobble") * 0.5),
      ]),
  },
  {
    id: "8bit",
    name: "8-bit",
    category: "era",
    description: "Extreme quantization and aliasing like an old console.",
    whenToUse: "Retro video games, pixelated transitions, nerdy humor or glitch.",
    tags: ["8bit", "video game", "chiptune", "pixel", "retro"],
    params: [
      { type: "number", id: "bits", label: "Bits", min: 2, max: 8, default: 4, step: 1 },
      { type: "number", id: "downsample", label: "Downsample", min: 1, max: 32, default: 12, step: 1 },
    ],
    build: (p, ctx) =>
      chain(ctx.input, ctx.output, [
        `acrusher=bits=${n(num(p, "bits"))}:samples=${n(num(p, "downsample"))}:mode=lin:aa=0:mix=1`,
        "highpass=f=120",
        "volume=-3dB",
      ]),
  },
];
