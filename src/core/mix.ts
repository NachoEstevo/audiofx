import { compile } from "./compile.js";
import { n } from "./graph.js";
import { getEffect } from "./registry.js";
import { SAMPLE_RATE, type EffectStep } from "./types.js";

/**
 * The mix engine: voice, music and effect tracks laid on a timeline and compiled into one
 * `-filter_complex` (one ffmpeg input per clip, one output `[out]`). Compiling is pure, so the studio
 * can run it in the browser; everything that needs the disk (resolving files, measuring durations and
 * sync points) happens before, in `prepareMix` (`mix-run.ts`).
 */

export type TrackRole = "voice" | "music" | "sfx";

/** One piece of audio on a track: a file (or a stretch of it) placed at a second of the timeline. */
export interface MixClip {
  /** Audio or video file (its audio is used): a path, or `library:<id>` for a file in the AudioFX library. */
  file: string;
  /** Second of the timeline where the clip starts (where its sync point lands, with `align`). Default 0. */
  at?: number;
  /** Second inside the file where the clip starts (trims the head). Default 0. */
  start?: number;
  /** Seconds of the file to use from `start`. Default (and at most): up to the end of the file. */
  length?: number;
  /** Clip gain in dB. Default 0. */
  gain?: number;
  /** Fade-in at the start of the clip, in seconds. Default 0. */
  fadeIn?: number;
  /** Fade-out at the end of the clip, in seconds. Default 0. */
  fadeOut?: number;
  /**
   * What lands on `at`: the clip's start (default), its measured attack (`onset`, for hits and doors) or
   * its loudest point (`peak`, for whooshes), like the `layer` effect. `prepareMix` measures it.
   */
  align?: "start" | "onset" | "peak";
  /** Effect chain on this clip, in clip time (0 = the clip's start). Tails ring past the clip's end. */
  steps?: EffectStep[];
}

/** How a track ducks under the voice. */
export interface DuckOptions {
  /** How many dB the track goes down while a voice plays. Default 10. */
  depth?: number;
  /** Milliseconds the track takes to go down when the voice starts. Default 20. */
  attack?: number;
  /** Milliseconds the track takes to come back (within 1 dB) after the voice stops. Default 400. */
  release?: number;
  /** Voice level (dBFS RMS) above which the voice counts as playing. Default -45. */
  threshold?: number;
}

export interface MixTrack {
  /** Unique id inside the project. */
  id: string;
  /** Name shown in the studio. */
  name?: string;
  /** What the track holds. `voice` tracks are the ducking key; `music` tracks duck by default. */
  role: TrackRole;
  /** Track gain in dB, after the track chain. Default 0. */
  gain?: number;
  /** Silences the track: it is not heard and does not duck other tracks. Wins over `solo`. */
  mute?: boolean;
  /**
   * When any track is soloed, only soloed tracks are heard. Voice tracks keep ducking the others even
   * when not heard, so a soloed music track sounds as it does in the full mix.
   */
  solo?: boolean;
  /** The clips. A track with no clips is silence of the project duration (for generator steps). */
  clips: MixClip[];
  /**
   * Effect chain on the whole track, in timeline time. Over a track with no clips, cinema effects
   * (`hit`, `riser`, `whoosh`...) act as generators placed with their `at`.
   */
  steps?: EffectStep[];
  /** Ducks this track under the voice tracks: true, false or settings. Default: on for music, off otherwise. */
  duck?: boolean | DuckOptions;
}

export interface MixMaster {
  /** Effect chain on the mix, before loudness and the ceiling. */
  steps?: EffectStep[];
  /** Integrated loudness target in LUFS (the `loudness` effect). Default -14; null leaves the level as mixed. */
  loudness?: number | null;
  /** Peak ceiling in dB (the `limiter` effect, always last). Default -1. */
  ceiling?: number;
}

export interface MixProject {
  /** Format version of the project file. */
  version: 1;
  /** Video whose picture is kept when exporting to a video file (its own audio is not used unless a clip uses it). */
  video?: string;
  /** Seconds. Default: the video's duration, or else the end of the last clip (including the tail its chain adds). */
  duration?: number;
  tracks: MixTrack[];
  /** The master bus. */
  master?: MixMaster;
}

/** What compiling needs to know about a file the project uses (`prepareMix` measures it). */
export interface MixSource {
  /** Seconds. */
  duration: number;
}

/** Measured sources, by the file path written in the (prepared) project. */
export type MixSources = Record<string, MixSource>;

export interface CompiledMix {
  /** Files to pass as ffmpeg inputs, in order: input i is `[i:a]` in the graph. */
  inputs: string[];
  /** Graph for `-filter_complex`; its output is `[out]`. */
  filterComplex: string;
  /** Seconds: the length of `[out]`. */
  duration: number;
}

export const DUCK_DEFAULTS: Required<DuckOptions> = { depth: 10, attack: 20, release: 400, threshold: -45 };
export const DEFAULT_LOUDNESS = -14;
export const DEFAULT_CEILING = -1;

const ROLES: readonly TrackRole[] = ["voice", "music", "sfx"];
const ALIGNS = ["start", "onset", "peak"];
const NORMALIZE = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
/**
 * With the gate design in `duckGraph`, the music is back within 1 dB about 1.68 times the compressor's
 * `release` after the voice stops (measured for depths of 3–30 dB), so the user's release is divided by it.
 */
const RELEASE_SPAN = 1.68;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

/** Validates the shape of a project (no files needed). compileMix and prepareMix call it first. */
export function validateMix(project: MixProject): void {
  check(!!project && typeof project === "object", "The mix project must be an object.");
  check(project.version === 1, `Unknown mix project version: ${JSON.stringify(project.version)}. Use "version": 1.`);
  check(Array.isArray(project.tracks), 'The mix project needs "tracks": [...].');
  check(project.duration === undefined || (finite(project.duration) && project.duration > 0), '"duration" must be a positive number of seconds.');
  check(project.video === undefined || (typeof project.video === "string" && !!project.video.trim()), '"video" must be a file.');
  const ids = new Set<string>();
  for (const track of project.tracks) {
    check(!!track && typeof track.id === "string" && !!track.id.trim(), 'Every track needs an "id".');
    const t = `Track "${track.id}"`;
    check(!ids.has(track.id), `${t} appears twice: track ids must be unique.`);
    ids.add(track.id);
    check(ROLES.includes(track.role), `${t}: "role" must be one of ${ROLES.join(", ")}.`);
    check(Array.isArray(track.clips), `${t} needs "clips": [...] (it may be empty).`);
    check(track.gain === undefined || finite(track.gain), `${t}: "gain" must be a number (dB).`);
    check(track.steps === undefined || Array.isArray(track.steps), `${t}: "steps" must be a list of effect steps.`);
    check(track.role !== "voice" || !track.duck, `${t}: voice tracks are what the others duck under; they cannot duck.`);
    if (track.duck !== undefined && typeof track.duck !== "boolean") {
      const d = track.duck;
      check(!!d && typeof d === "object", `${t}: "duck" must be true, false or { depth, attack, release, threshold }.`);
      check(d.depth === undefined || (finite(d.depth) && d.depth >= 0 && d.depth <= 40), `${t}: duck depth must be 0–40 dB.`);
      check(d.attack === undefined || (finite(d.attack) && d.attack >= 1 && d.attack <= 2000), `${t}: duck attack must be 1–2000 ms.`);
      check(d.release === undefined || (finite(d.release) && d.release >= 50 && d.release <= 10000), `${t}: duck release must be 50–10000 ms.`);
      check(d.threshold === undefined || (finite(d.threshold) && d.threshold >= -80 && d.threshold <= -10), `${t}: duck threshold must be -80 to -10 dBFS.`);
    }
    track.clips.forEach((clip, i) => {
      const c = `${t}, clip ${i + 1}`;
      check(!!clip && typeof clip.file === "string" && !!clip.file.trim(), `${c} needs a "file".`);
      for (const key of ["at", "start", "fadeIn", "fadeOut"] as const) {
        check(clip[key] === undefined || (finite(clip[key]) && clip[key]! >= 0), `${c}: "${key}" must be a number of seconds ≥ 0.`);
      }
      check(clip.length === undefined || (finite(clip.length) && clip.length > 0), `${c}: "length" must be a positive number of seconds.`);
      check(clip.gain === undefined || finite(clip.gain), `${c}: "gain" must be a number (dB).`);
      check(clip.align === undefined || ALIGNS.includes(clip.align), `${c}: "align" must be start, onset or peak.`);
      check(clip.steps === undefined || Array.isArray(clip.steps), `${c}: "steps" must be a list of effect steps.`);
    });
  }
  const m = project.master;
  if (m !== undefined) {
    check(!!m && typeof m === "object", '"master" must be an object.');
    check(m.loudness === undefined || m.loudness === null || finite(m.loudness), 'master "loudness" must be a LUFS number or null.');
    check(m.ceiling === undefined || finite(m.ceiling), 'master "ceiling" must be a number (dB).');
    check(m.steps === undefined || Array.isArray(m.steps), 'master "steps" must be a list of effect steps.');
  }
}

function sourceOf(file: string, sources: MixSources, what: string): MixSource {
  const source = sources[file];
  if (!source || !finite(source.duration)) throw new Error(`${what}: no measured duration for "${file}". Prepare the project first (prepareMix).`);
  return source;
}

/** Seconds a clip occupies on its track, from its file and trims. */
function clipLength(clip: MixClip, sources: MixSources, what: string): number {
  const start = clip.start ?? 0;
  const available = sourceOf(clip.file, sources, what).duration - start;
  if (available <= 0.001) throw new Error(`${what}: "start" (${start} s) is past the end of ${clip.file}.`);
  return Math.min(clip.length ?? available, available);
}

/** Seconds of tail a chain adds after the clip (compile pads 3 s for reverbs and echoes). */
const chainTail = (steps: EffectStep[] | undefined) => (steps?.length ? compile(steps, { normalize: false }).tail : 0);

/** The project's length: `duration`, else the video's, else the end of the last clip (with its tail). */
export function projectDuration(project: MixProject, sources: MixSources): number {
  if (project.duration !== undefined) return project.duration;
  if (project.video) return sourceOf(project.video, sources, "video").duration;
  let end = 0;
  project.tracks.forEach((track) =>
    track.clips.forEach((clip, i) => {
      const what = `Track "${track.id}", clip ${i + 1}`;
      end = Math.max(end, (clip.at ?? 0) + clipLength(clip, sources, what) + chainTail(clip.steps));
    }),
  );
  if (end <= 0) throw new Error('The project has no clips to measure its length: set "duration" (seconds) or a "video".');
  return end;
}

const duckOf = (track: MixTrack): Required<DuckOptions> | null => {
  const duck = track.duck ?? track.role === "music";
  if (duck === false) return null;
  return { ...DUCK_DEFAULTS, ...(duck === true ? {} : duck) };
};

/** A compiled chain between two labels of the filter_complex. */
function embed(steps: EffectStep[], input: string, output: string, options: { prefix: string; seed: number; tail?: number; where?: string }): string {
  if (options.where) {
    for (const step of steps) {
      if (getEffect(step.effect).changesDuration) {
        throw new Error(`${step.effect} changes the audio duration and cannot go on ${options.where}: the timeline would drift. Put it on a clip.`);
      }
    }
  }
  const { graph } = compile(steps, { normalize: false, labelPrefix: options.prefix, seed: options.seed, tail: options.tail });
  return `[${input}]${graph}[${output}]`;
}

/** Sums labeled streams without normalizing (one stream passes through). */
function sum(inputs: string[], output: string): string {
  if (inputs.length === 1) return `[${inputs[0]}]anull[${output}]`;
  return `${inputs.map((i) => `[${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0[${output}]`;
}

/** Splits a labeled stream into `outputs`. */
function split(input: string, outputs: string[]): string {
  if (outputs.length === 1) return `[${input}]anull[${outputs[0]}]`;
  return `[${input}]asplit=${outputs.length}${outputs.map((o) => `[${o}]`).join("")}`;
}

/**
 * Ducks [track] under [key] (the voices) by exactly `depth` dB, however loud the voice is.
 *
 * Feeding the voice straight into `sidechaincompress` makes the depth depend on the voice level (with
 * depth 10, -9.7 dB under a -29 dBFS voice but -8.1 dB under a -45 dBFS one) and so does the release. So:
 * 1. A gate turns the voice into 0/1: "playing" while its RMS (5 ms) is above `threshold`.
 * 2. `sidechaincompress` on a constant 1, keyed by that gate (ratio 20, threshold -60 dB), gives a gain
 *    curve with its release: under the voice the compressed signal is ~57 dB down, so `mix` sets the gain
 *    to 1 - mix = 10^(-depth/20), and the curve holds through short pauses between words.
 * 3. A one-pole lowpass on the gain reduction shapes the attack; the track is multiplied by the curve.
 */
function duckGraph(track: string, key: string, output: string, p: string, duck: Required<DuckOptions>, samples: number): string {
  const mix = 1 - Math.pow(10, -duck.depth / 20);
  const power = Math.pow(10, duck.threshold / 10);
  const smoothHz = 1 / (2 * Math.PI * (duck.attack / 1000 / 3));
  return [
    `[${key}]aeval='(val(0)*val(0)+val(1)*val(1))/2':c=mono,lowpass=f=32:p=1,aeval='gt(val(0),${n(power, 12)})':c=mono[${p}gate]`,
    `aevalsrc=1:c=stereo:s=${SAMPLE_RATE},atrim=end_sample=${samples}[${p}one]`,
    `[${p}one][${p}gate]sidechaincompress=threshold=0.001:ratio=20:knee=1:detection=peak:attack=0.01:release=${n(duck.release / RELEASE_SPAN)}:mix=${n(mix, 6)},` +
      `aeval='1-val(ch)':c=same,lowpass=f=${n(smoothHz)}:p=1,aeval='1-val(ch)':c=same[${p}gain]`,
    `[${track}][${p}gain]amultiply[${output}]`,
  ].join(";");
}

/** Compiles a mix project into one filter_complex. `sources` holds every file's duration (prepareMix measures them). */
export function compileMix(project: MixProject, sources: MixSources): CompiledMix {
  validateMix(project);
  const duration = projectDuration(project, sources);
  const samples = Math.round(duration * SAMPLE_RATE);
  const fit = `apad=whole_len=${samples},atrim=end_sample=${samples}`;
  const silence = `anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=end_sample=${samples},aformat=sample_fmts=fltp`;
  const inputs: string[] = [];
  const parts: string[] = [];
  let chains = 0;
  const seed = () => 1234 + 1000 * chains++;

  const playable = (t: MixTrack) => t.clips.some((c) => (c.at ?? 0) < duration) || !!t.steps?.length;
  const anySolo = project.tracks.some((t) => t.solo && !t.mute);
  const heard = project.tracks.filter((t) => !t.mute && (!anySolo || t.solo) && playable(t));
  const ducked = heard.filter((t) => t.role !== "voice" && duckOf(t));
  // Voices duck the others even when a solo hides them: only mute takes a voice out of the key.
  const keyed = ducked.length ? project.tracks.filter((t) => t.role === "voice" && !t.mute && playable(t)) : [];

  const built = new Map<MixTrack, string>();
  project.tracks.forEach((track, ti) => {
    if (!heard.includes(track) && !keyed.includes(track)) return;
    const tp = `t${ti + 1}`;
    const what = `Track "${track.id}"`;
    const clipOuts: string[] = [];
    track.clips.forEach((clip, ci) => {
      const cw = `${what}, clip ${ci + 1}`;
      if (clip.align && clip.align !== "start") throw new Error(`${cw}: align=${clip.align} is measured from the file. Prepare the project first (prepareMix).`);
      const at = clip.at ?? 0;
      const length = clipLength(clip, sources, cw);
      if (at >= duration) return;
      const fadeIn = clip.fadeIn ?? 0;
      const fadeOut = clip.fadeOut ?? 0;
      if (fadeIn + fadeOut > length + 1e-6) throw new Error(`${cw}: the fades (${fadeIn} + ${fadeOut} s) are longer than the clip (${n(length, 3)} s).`);
      const cp = `${tp}c${ci + 1}`;
      const start = Math.round((clip.start ?? 0) * SAMPLE_RATE);
      // Timestamps first, so trims count from the file's first sample even when it does not start at 0 (mp3, mp4).
      const head = ["asetpts=PTS-STARTPTS", NORMALIZE, `atrim=start_sample=${start}:end_sample=${start + Math.round(length * SAMPLE_RATE)}`, "asetpts=PTS-STARTPTS"];
      if (fadeIn > 0) head.push(`afade=t=in:st=0:d=${n(fadeIn)}`);
      if (fadeOut > 0) head.push(`afade=t=out:st=${n(length - fadeOut)}:d=${n(fadeOut)}`);
      parts.push(`[${inputs.length}:a]${head.join(",")}[${cp}in]`);
      inputs.push(clip.file);
      let current = `${cp}in`;
      if (clip.steps?.length) {
        parts.push(embed(clip.steps, current, `${cp}fx`, { prefix: `${cp}_`, seed: seed() }));
        current = `${cp}fx`;
      }
      parts.push(`[${current}]volume=${n(clip.gain ?? 0)}dB,adelay=delays=${Math.round(at * SAMPLE_RATE)}S:all=1[${cp}]`);
      clipOuts.push(cp);
    });

    let current = `${tp}sum`;
    if (clipOuts.length) parts.push(`${sum(clipOuts, `${tp}raw`)};[${tp}raw]${fit}[${current}]`);
    // Silence the length of the project: generator steps (hit, riser...) mix their sound into it.
    else parts.push(`${silence}[${current}]`);
    if (track.steps?.length) {
      parts.push(embed(track.steps, current, `${tp}fx`, { prefix: `${tp}_`, seed: seed(), tail: 0, where: `a track ("${track.id}")` }));
      current = `${tp}fx`;
    }
    parts.push(`[${current}]volume=${n(track.gain ?? 0)}dB[${tp}]`);
    built.set(track, tp);
  });

  const toMaster = new Map(heard.map((t) => [t, built.get(t)!]));
  if (keyed.length) {
    // The ducking key: the voices as they sound (after their chains and gains).
    const keyLabels = keyed.map((voice) => {
      const label = built.get(voice)!;
      if (!heard.includes(voice)) return label;
      parts.push(split(label, [`${label}m`, `${label}k`]));
      toMaster.set(voice, `${label}m`);
      return `${label}k`;
    });
    parts.push(sum(keyLabels, "voicekey"));
    parts.push(split("voicekey", ducked.map((_, i) => `key${i + 1}`)));
    ducked.forEach((track, i) => {
      const label = built.get(track)!;
      parts.push(duckGraph(label, `key${i + 1}`, `${label}duck`, `${label}d_`, duckOf(track)!, samples));
      toMaster.set(track, `${label}duck`);
    });
  }

  const buses = [...toMaster.values()];
  parts.push(buses.length ? sum(buses, "mix") : `${silence}[mix]`);

  const master = project.master ?? {};
  const ceiling = master.ceiling ?? DEFAULT_CEILING;
  const loudness = master.loudness === undefined ? DEFAULT_LOUDNESS : master.loudness;
  const steps: EffectStep[] = [...(master.steps ?? [])];
  // loudnorm's true-peak target follows the ceiling, so the limiter only catches what is left.
  if (loudness !== null) steps.push({ effect: "loudness", params: { target: loudness, truePeak: Math.min(0, Math.max(-6, ceiling)) } });
  steps.push({ effect: "limiter", params: { ceiling } });
  parts.push(embed(steps, "mix", "master", { prefix: "m_", seed: seed(), tail: 0, where: "the master" }));
  parts.push(`[master]${fit}[out]`);

  return { inputs, filterComplex: parts.join(";"), duration };
}
