import { existsSync } from "node:fs";
import path from "node:path";
import { LIBRARY_REF } from "./effects/layer.js";
import { audioCodecArgs, isVideoFile, measureSync, runFfmpeg } from "./ffmpeg.js";
import { probeMedia, type MediaInfo } from "./media.js";
import { DEFAULT_LOUDNESS, compileMix, validateMix, type CompiledMix, type MixClip, type MixProject } from "./mix.js";
import { prepareSteps, type PrepareOptions } from "./prepare.js";
import { getEffect } from "./registry.js";
import { SAMPLE_RATE, type EffectStep } from "./types.js";

export interface PrepareMixOptions extends PrepareOptions {
  /** Folder that relative paths are resolved against: the project file's folder. Defaults to the current folder. */
  baseDir?: string;
}

export interface PreparedMix {
  /** The project with absolute paths, clip alignments measured and chains prepared: ready for compileMix. */
  project: MixProject;
  /** What each file holds, by its absolute path. */
  media: Record<string, MediaInfo>;
}

/** A file param of a chain step, relative to the project's folder instead of the current one. */
function rebase(step: EffectStep, baseDir: string): EffectStep {
  const files = getEffect(step.effect).params.filter((p) => p.type === "file");
  if (!files.length || !step.params) return step;
  const params = { ...step.params };
  for (const spec of files) {
    const value = params[spec.id];
    if (typeof value === "string" && value.trim() && !value.startsWith(LIBRARY_REF)) params[spec.id] = path.resolve(baseDir, value.trim());
  }
  return { ...step, params };
}

/** Where a clip lands once its sync point (attack or loudest moment) is put on `at`. */
async function aligned(clip: MixClip, file: string, what: string): Promise<MixClip> {
  const { align, ...rest } = clip;
  if (align !== "onset" && align !== "peak") return rest;
  const points = await measureSync(file, { start: clip.start, length: clip.length });
  const sync = align === "onset" ? points.onset : points.peak;
  const at = clip.at ?? 0;
  // The part before the sync point plays earlier; whatever would fall before 0 is trimmed.
  const early = Math.max(0, sync - at);
  const placed: MixClip = { ...rest, at: Math.max(0, at - sync) };
  if (early > 0) {
    placed.start = (clip.start ?? 0) + early;
    if (clip.length !== undefined) {
      if (clip.length <= early) throw new Error(`${what}: the clip ends before its ${align} reaches the start of the timeline.`);
      placed.length = clip.length - early;
    }
  }
  return placed;
}

/**
 * Everything a project needs from the disk before compiling: `library:<id>` references and relative paths
 * become absolute paths that exist (relative to `baseDir`), every file is probed, clip alignments are
 * measured, and every chain goes through `prepareSteps`.
 */
export async function prepareMix(project: MixProject, options: PrepareMixOptions = {}): Promise<PreparedMix> {
  validateMix(project);
  const baseDir = options.baseDir ?? process.cwd();
  const resolve = (raw: string, what: string) => {
    const ref = raw.trim();
    let file: string;
    if (ref.startsWith(LIBRARY_REF)) {
      const found = options.resolveLibrary?.(ref.slice(LIBRARY_REF.length));
      if (!found) throw new Error(`${what}: "${ref}" is not in the library. Run \`sfx sample list\` (or refresh the studio).`);
      file = found;
    } else if (options.libraryOnly) {
      throw new Error(`${what}: pick a file from the library.`);
    } else {
      file = path.resolve(baseDir, ref);
    }
    if (!existsSync(file)) throw new Error(`${what}: file not found: ${raw}`);
    return file;
  };
  const chain = async (steps: EffectStep[] | undefined, what: string) => {
    if (!steps?.length) return steps;
    try {
      return await prepareSteps(options.libraryOnly ? steps : steps.map((s) => rebase(s, baseDir)), options);
    } catch (error) {
      throw new Error(`${what}: ${(error as Error).message}`);
    }
  };

  const video = project.video ? resolve(project.video, "video") : undefined;
  const files = project.tracks.map((track) => track.clips.map((clip, i) => resolve(clip.file, `Track "${track.id}", clip ${i + 1}`)));
  const unique = [...new Set([...files.flat(), ...(video ? [video] : [])])];
  const probed = await Promise.all(unique.map(probeMedia));
  const media = Object.fromEntries(unique.map((file, i) => [file, probed[i]]));
  if (video && !media[video].hasVideo) throw new Error(`video: ${project.video} has no picture.`);

  const tracks = [];
  for (const [ti, track] of project.tracks.entries()) {
    const clips: MixClip[] = [];
    for (const [ci, clip] of track.clips.entries()) {
      const what = `Track "${track.id}", clip ${ci + 1}`;
      const file = files[ti][ci];
      if (!media[file].hasAudio) throw new Error(`${what}: ${clip.file} has no audio.`);
      const placed = await aligned({ ...clip, file }, file, what);
      clips.push({ ...placed, steps: await chain(clip.steps, what) });
    }
    tracks.push({ ...track, clips, steps: await chain(track.steps, `Track "${track.id}"`) });
  }
  const master = project.master && { ...project.master, steps: await chain(project.master.steps, "master") };
  return { project: { ...project, video, tracks, master }, media };
}

/**
 * The master gain that brings a prepared mix to its loudness target: renders it once without the loudness
 * stage, measures the integrated loudness (EBU R128) and returns the difference. undefined when the project
 * turns loudness off or the mix is too quiet or short to measure.
 */
async function loudnessGain(prepared: PreparedMix): Promise<number | undefined> {
  const target = prepared.project.master?.loudness === undefined ? DEFAULT_LOUDNESS : prepared.project.master.loudness;
  if (target === null) return undefined;
  const flat = compileMix(prepared.project, prepared.media, { masterGain: 0 });
  const { stderr } = await runFfmpeg([
    "-v", "info", ...flat.inputs.flatMap((input) => ["-i", input]),
    "-filter_complex", `${flat.filterComplex};[out]ebur128=framelog=quiet[measured]`, "-map", "[measured]", "-f", "null", "-",
  ]);
  const last = [...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const measured = last ? Number(last[1]) : NaN;
  // ebur128 reports -70 for silence and for less than its 400 ms window: nothing to normalize.
  return Number.isFinite(measured) && measured > -60 ? target - measured : 0;
}

/** A rendered mix: what was compiled and where it was written. */
export interface MixRender extends CompiledMix {
  output: string;
}

/**
 * Prepares, compiles and renders a project. The output is an audio file (codec by extension), a video
 * (the project's `video` picture copied untouched, the mix as its audio, cut to the project duration), or
 * "buffer" for a 16-bit 48 kHz WAV in memory (the studio preview). Loudness is normalized in two passes
 * (measure, then a fixed gain before the ceiling), so the mix is rendered twice unless `master.loudness` is null.
 */
export async function renderMix(project: MixProject, output: "buffer", options?: PrepareMixOptions): Promise<Buffer>;
export async function renderMix(project: MixProject, output: string, options?: PrepareMixOptions): Promise<MixRender>;
export async function renderMix(project: MixProject, output: string, options: PrepareMixOptions = {}): Promise<MixRender | Buffer> {
  const prepared = await prepareMix(project, options);
  // Two passes: the measured gain lands on the target where single-pass loudnorm does not.
  const compiled = compileMix(prepared.project, prepared.media, { masterGain: await loudnessGain(prepared) });
  const args = ["-y", "-v", "error", ...compiled.inputs.flatMap((input) => ["-i", input])];
  if (output === "buffer") {
    const { stdout } = await runFfmpeg([
      ...args, "-filter_complex", compiled.filterComplex, "-map", "[out]", "-c:a", "pcm_s16le", "-ar", String(SAMPLE_RATE), "-f", "wav", "-",
    ]);
    return stdout;
  }
  // Metadata would otherwise come from the first clip (an mp3's title, say).
  let maps = ["-map", "[out]", "-vn", "-map_metadata", "-1"];
  if (isVideoFile(output)) {
    const video = prepared.project.video;
    if (!video) throw new Error(`${path.basename(output)} is a video: give the project a "video" whose picture to keep, or export audio (wav, mp3...).`);
    const index = compiled.inputs.length;
    args.push("-i", video);
    maps = ["-map", `${index}:v:0`, "-map", "[out]", "-map_metadata", String(index), "-c:v", "copy", "-t", String(compiled.duration)];
  }
  await runFfmpeg([...args, "-filter_complex", compiled.filterComplex, ...maps, ...audioCodecArgs(output), output]);
  return { output, ...compiled };
}
