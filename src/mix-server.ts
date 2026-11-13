import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  analyzeFile,
  detectCuts,
  getEffect,
  LIBRARY_REF,
  probeMedia,
  renderMix,
  runFfmpeg,
  validateMix,
  type Analysis,
  type Cut,
  type EffectStep,
  type MediaInfo,
  type MixClip,
  type MixProject,
  type MixTrack,
} from "./core/index.js";
import { execFfmpeg } from "./core/ffmpeg.js";

/**
 * The studio's Mix screen on the server: a video kept for the session (served with Range so the browser
 * can seek it, through a small proxy when browsers cannot play its codec), its cuts, mix previews and
 * exports. Like the rest of the studio, the browser only ever sends ids: source ids the server issued,
 * video ids, and `library:<id>` references. The pure parts (Range parsing, the playable decision, mapping
 * a project to files) are exported for the tests.
 */

/** Longest stretch of audio the Mix screen previews (the Sounds screen keeps 180 s). The export is whole. */
export const MIX_PREVIEW_SECONDS = 600;
const MAX_VIDEO_BYTES = 8 * 1024 ** 3;
const MAX_AUDIO_BYTES = 2 * 1024 ** 3;
const MAX_PROJECT_BYTES = 2 * 1024 ** 2;
const KEPT_RENDERS = 4;

// ---------------------------------------------------------------------------------------------------------
// Pure parts

export type ByteRange = { start: number; end: number };

/**
 * Reads a `Range` header against a file of `size` bytes: the inclusive byte range to send, "unsatisfiable"
 * (answer 416), or null to send the whole file (no header, another unit, several ranges, or an invalid
 * one, which RFC 9110 lets a server ignore).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // A suffix: the last N bytes.
    const length = Number(m[2]);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== "" && Number(m[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

/** What decides whether a browser plays a picture: its container (file extension), codec and pixel format. */
export interface PictureFormat {
  container: string;
  codec?: string;
  pixelFormat?: string;
}

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC (H.265)",
  prores: "ProRes",
  dnxhd: "DNxHD/DNxHR",
  mpeg4: "MPEG-4 Part 2",
  mpeg2video: "MPEG-2",
  mjpeg: "Motion JPEG",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
};
/** Containers browsers open, and the codecs they decode in each. A .mov only with H.264 (it is an MP4 cousin). */
const CONTAINER_CODECS: Record<string, string[]> = {
  ".mp4": ["h264", "vp9", "av1"],
  ".m4v": ["h264", "vp9", "av1"],
  ".mov": ["h264"],
  ".webm": ["vp8", "vp9", "av1"],
};
/** 8-bit 4:2:0 for H.264 (High 10 and 4:2:2 camera files do not play); VP9 and AV1 also play 10-bit 4:2:0. */
const PIXEL_FORMATS: Record<string, string[]> = {
  h264: ["yuv420p", "yuvj420p"],
  vp8: ["yuv420p", "yuva420p"],
  vp9: ["yuv420p", "yuva420p", "yuv420p10le"],
  av1: ["yuv420p", "yuv420p10le"],
};

const codecName = (codec: string) => CODEC_NAMES[codec] ?? codec;

/** Whether browsers play this picture as it is. When they do not, the studio serves a proxy and keeps the original for export. */
export function browserPlays(format: PictureFormat): { plays: boolean; reason: string } {
  const container = format.container.toLowerCase();
  const codec = format.codec?.toLowerCase();
  if (!codec) return { plays: false, reason: "The picture's codec could not be read." };
  const codecs = CONTAINER_CODECS[container];
  if (!codecs) return { plays: false, reason: `Browsers do not open ${container ? `${container.slice(1).toUpperCase()} files` : "this file"}.` };
  if (!codecs.includes(codec)) return { plays: false, reason: `Browsers do not play ${codecName(codec)} in ${container.slice(1).toUpperCase()}.` };
  const pixels = format.pixelFormat?.toLowerCase();
  if (pixels && !PIXEL_FORMATS[codec].includes(pixels)) {
    return { plays: false, reason: `Browsers do not play ${codecName(codec)} with ${pixels} pixels (10-bit or 4:2:2).` };
  }
  return { plays: true, reason: `${codecName(codec)} in ${container.slice(1).toUpperCase()}` };
}

/** Pixel format of the first video stream in `ffmpeg -i` output, e.g. "yuv420p" or "yuv422p10le". */
export function pixelFormatOf(stderr: string): string | undefined {
  const line = [...stderr.matchAll(/^\s*Stream #0:\d+.*?: Video: (.*)$/gm)].find((s) => !/attached pic/.test(s[1]));
  if (!line) return undefined;
  return /,\s*((?:yuvj?|nv|p0|gray|rgb|bgr|gbr|argb|rgba|bgra|abgr|ya)[a-z0-9]*)/i.exec(line[1])?.[1].toLowerCase();
}

/** An encoder that can make the browser proxy of a picture. */
export interface ProxyEncoder {
  name: string;
  ext: ".mp4" | ".webm";
  args: string[];
}

/** Short keyframe interval: the browser seeks a proxy often, and every seek decodes from a keyframe. */
const GOP = ["-g", "15"];
const PROXY_ENCODERS: ProxyEncoder[] = [
  { name: "libx264", ext: ".mp4", args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "27", ...GOP] },
  { name: "libopenh264", ext: ".mp4", args: ["-c:v", "libopenh264", "-b:v", "2500k", ...GOP] },
  { name: "h264_videotoolbox", ext: ".mp4", args: ["-c:v", "h264_videotoolbox", "-b:v", "3M", ...GOP] },
  { name: "h264_mf", ext: ".mp4", args: ["-c:v", "h264_mf", "-b:v", "3M", ...GOP] },
  { name: "h264_nvenc", ext: ".mp4", args: ["-c:v", "h264_nvenc", "-b:v", "3M", ...GOP] },
  { name: "h264_qsv", ext: ".mp4", args: ["-c:v", "h264_qsv", "-b:v", "3M", ...GOP] },
  { name: "h264_amf", ext: ".mp4", args: ["-c:v", "h264_amf", "-b:v", "3M", ...GOP] },
  { name: "libvpx-vp9", ext: ".webm", args: ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", ...GOP] },
  { name: "libvpx", ext: ".webm", args: ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", ...GOP] },
];

/** The proxy encoders this ffmpeg build lists (`ffmpeg -encoders`), in order of preference. */
export function proxyEncoders(listing: string): ProxyEncoder[] {
  const available = new Set([...listing.matchAll(/^\s*V\S{5}\s+(\S+)/gm)].map((m) => m[1]));
  return PROXY_ENCODERS.filter((e) => available.has(e.name));
}

/** Files the browser may send to be mixed: ids the server issued and library references, never paths. */
export interface MixLookup {
  /** An uploaded, demo or generated audio, by its source id. */
  source(id: string): string | undefined;
  /** A loaded video's original file, by its video id. */
  video(id: string): string | undefined;
  /** A file of the library, by its library id. */
  library(id: string): string | undefined;
}

const ID = /^[\w-]{1,64}$/;

function pickStep(step: EffectStep, what: string, lookup: MixLookup): EffectStep {
  if (!step || typeof step !== "object" || typeof step.effect !== "string") throw new Error(`${what}: every step needs an "effect".`);
  const effect = getEffect(step.effect);
  for (const spec of effect.params) {
    if (spec.type !== "file") continue;
    const value = step.params?.[spec.id];
    if (value === undefined || value === "") continue;
    const ref = typeof value === "string" && value.startsWith(LIBRARY_REF) ? value.slice(LIBRARY_REF.length) : null;
    if (ref === null) throw new Error(`${what}, ${effect.id}: pick a sample from the library.`);
    if (!lookup.library(ref)) throw new Error(`${what}, ${effect.id}: "${value}" is no longer in the library. Refresh it and pick the sample again.`);
  }
  const { effect: id, params, from, to, fade, mix } = step;
  return { effect: id, params, from, to, fade, mix };
}

/**
 * Turns a project from the browser into one ffmpeg can render: clip files that are source ids or
 * `library:<id>` become the files they stand for, `video` (a video id) becomes the original video, and
 * samples inside chains must be library references (prepareMix resolves them). Anything else, a path above
 * all, is rejected.
 */
export function mapProject(input: unknown, lookup: MixLookup): MixProject {
  validateMix(input as MixProject);
  const project = input as MixProject;
  const steps = (list: EffectStep[] | undefined, what: string) => list?.map((s, i) => pickStep(s, `${what}, step ${i + 1}`, lookup));
  const file = (raw: string, what: string) => {
    const ref = raw.trim();
    if (ref.startsWith(LIBRARY_REF)) {
      const found = lookup.library(ref.slice(LIBRARY_REF.length));
      if (!found) throw new Error(`${what}: "${ref}" is no longer in the library. Refresh it and add the audio again.`);
      return found;
    }
    const found = ID.test(ref) ? lookup.source(ref) : undefined;
    if (!found) throw new Error(`${what}: "${ref}" is not audio this studio loaded. Add it again from the library or as an upload.`);
    return found;
  };
  let video: string | undefined;
  if (project.video !== undefined) {
    video = ID.test(project.video) ? lookup.video(project.video) : undefined;
    if (!video) throw new Error("video: that video is not loaded in the studio any more. Load it again.");
  }
  const tracks = project.tracks.map((track): MixTrack => {
    const t = `Track "${track.id}"`;
    const clips = track.clips.map((clip, i): MixClip => {
      const c = `${t}, clip ${i + 1}`;
      const { at, start, length, gain, fadeIn, fadeOut, align } = clip;
      return { file: file(clip.file, c), at, start, length, gain, fadeIn, fadeOut, align, steps: steps(clip.steps, c) };
    });
    const { id, name, role, gain, mute, solo, duck } = track;
    return { id, name, role, gain, mute, solo, duck, clips, steps: steps(track.steps, t) };
  });
  const master = project.master && { loudness: project.master.loudness, ceiling: project.master.ceiling, steps: steps(project.master.steps, "master") };
  return { version: 1, duration: project.duration, video, tracks, master };
}

const VIDEO_EXPORT_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm"]);

/** The export keeps the original container when AudioFX can write it; anything else goes into Matroska, which takes any codec. */
export const videoExportExt = (original: string) => {
  const ext = path.extname(original).toLowerCase();
  return VIDEO_EXPORT_EXT.has(ext) ? ext : ".mkv";
};

/** Download names: "interview (mix).mp4" for the video, "interview mix.wav" for the mix. */
export function exportName(videoName: string | undefined, kind: "wav" | "video"): string {
  // The browser sends a bare file name; characters Windows forbids go first (path.parse reads "a:" as a drive).
  // eslint-disable-next-line no-control-regex
  const clean = (videoName ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "");
  const base = clean.replace(/\.[^.]*$/, "").trim() || "AudioFX";
  return kind === "wav" ? `${base} mix.wav` : `${base} (mix)${videoExportExt(videoName ?? "")}`;
}

/** `Content-Disposition` for a download, with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ---------------------------------------------------------------------------------------------------------
// Media

/** What decides whether the browser plays a video file, read from the file itself. */
export async function pictureFormat(file: string, info?: MediaInfo): Promise<PictureFormat> {
  const media = info ?? (await probeMedia(file));
  const { stderr } = await execFfmpeg(["-i", file]);
  return { container: path.extname(file).toLowerCase(), codec: media.videoCodec, pixelFormat: pixelFormatOf(stderr) };
}

let encoderListing: Promise<string> | undefined;

/**
 * Makes the browser proxy of a picture: H.264 (or VP9/VP8 in WebM), at most 540 lines, no audio, same
 * frame rate and timeline. Tries each encoder this ffmpeg has until one works (hardware encoders can be
 * listed and still fail on a machine without that GPU).
 */
export async function makeProxy(input: string, outputBase: string): Promise<{ file: string; encoder: string }> {
  encoderListing ??= execFfmpeg(["-encoders"]).then((r) => r.stdout.toString() + r.stderr);
  const candidates = proxyEncoders(await encoderListing);
  if (!candidates.length) {
    throw new Error(
      "This ffmpeg has no encoder for a browser preview of the picture (H.264, VP9 or VP8). Install a full build (winget install Gyan.FFmpeg) or set AUDIOFX_FFMPEG to one.",
    );
  }
  const failures: string[] = [];
  for (const encoder of candidates) {
    const file = `${outputBase}${encoder.ext}`;
    try {
      await runFfmpeg([
        "-y", "-v", "error", "-i", input, "-map", "0:v:0", "-an", "-sn", "-dn",
        "-vf", "scale=-2:'2*trunc(min(540,ih)/2)',format=yuv420p", ...encoder.args,
        ...(encoder.ext === ".mp4" ? ["-movflags", "+faststart"] : []), file,
      ]);
      return { file, encoder: encoder.name };
    } catch (error) {
      rmSync(file, { force: true });
      failures.push(`${encoder.name}: ${(error as Error).message.split("\n").pop()}`);
    }
  }
  throw new Error(`Could not make a browser preview of the picture. Tried ${failures.join("; ")}`);
}

// ---------------------------------------------------------------------------------------------------------
// HTTP

/** An audio source of the studio: a normalized 48 kHz WAV. */
export interface StudioSource {
  id: string;
  name: string;
  file: string;
  duration: number;
}

/** What the Mix API needs from the studio server. */
export interface MixContext {
  workDir: string;
  sources: Map<string, StudioSource>;
  /** Normalizes audio (or a video's audio) to a 48 kHz WAV of at most `maxSeconds` and registers it. */
  addSource(input: string, name: string, maxSeconds: number): Promise<StudioSource>;
  /** The current library scan. */
  library(): { items: { id: string; name: string }[]; paths: Map<string, string> };
}

interface MixVideo {
  id: string;
  name: string;
  file: string;
  info: MediaInfo;
  plays: boolean;
  reason: string;
  audio: StudioSource | null;
  proxy?: Promise<{ file: string; encoder: string }>;
  cuts: Map<number, Promise<Cut[]>>;
}

const VIDEO_MIME: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska" };

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_PROJECT_BYTES) throw new Error("The project is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The body is not valid JSON.");
  }
}

/** Streams a file with Range support (206, Accept-Ranges, Content-Range; 416 for a range past the end). */
export async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, download?: string) {
  const size = statSync(file).size;
  const headers: Record<string, string | number> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (download) headers["content-disposition"] = contentDisposition(download);
  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    return void res.end();
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, { ...headers, "content-length": size ? end - start + 1 : 0 });
  if (req.method === "HEAD" || !size) return void res.end();
  // A browser that seeks closes the previous request: that is not an error.
  await pipeline(createReadStream(file, { start, end }), res).catch(() => {});
}

const fileName = (req: IncomingMessage, fallback: string) => {
  try {
    return decodeURIComponent(String(req.headers["x-filename"] ?? fallback)).trim() || fallback;
  } catch {
    return fallback;
  }
};

const safeExt = (name: string) => {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : "";
};

const removeQuietly = (file: string) => {
  try {
    rmSync(file, { force: true });
  } catch {
    // Windows keeps a file that is being served; the work dir goes on exit.
  }
};

/** The Mix screen's routes, under /api/mix/. `handle` answers false for anything else. */
export function createMixApi(ctx: MixContext) {
  const videos = new Map<string, MixVideo>();
  const librarySources = new Map<string, StudioSource>();
  const renders = new Map<string, { wav: Buffer; analysis?: Promise<Analysis> }>();
  const exported = new Map<string, { file: string; name: string; type: string; kind: "wav" | "video" }>();
  const lookup: MixLookup = {
    source: (id) => ctx.sources.get(id)?.file,
    video: (id) => videos.get(id)?.file,
    library: (id) => ctx.library().paths.get(id),
  };
  const resolveLibrary = (id: string) => ctx.library().paths.get(id);
  const sourceJson = (s: StudioSource) => ({ id: s.id, name: s.name, duration: s.duration, truncated: s.duration >= MIX_PREVIEW_SECONDS - 0.05 });

  const proxyOf = (video: MixVideo) => {
    if (!video.proxy) {
      video.proxy = makeProxy(video.file, path.join(ctx.workDir, `proxy-${video.id}`));
      video.proxy.catch(() => {});
    }
    return video.proxy;
  };

  /** The video a project from the browser names, if it is loaded. */
  const videoOf = (input: unknown) => {
    const id = (input as { video?: unknown } | null)?.video;
    return typeof id === "string" ? videos.get(id) : undefined;
  };

  /** The preview covers at most MIX_PREVIEW_SECONDS; the export is the whole project. */
  const previewOf = (project: MixProject, video: MixVideo | undefined): MixProject => {
    const length = project.duration ?? video?.info.duration;
    return length !== undefined && length > MIX_PREVIEW_SECONDS ? { ...project, duration: MIX_PREVIEW_SECONDS } : project;
  };

  /** Streams an upload to the work dir; a broken upload leaves nothing behind. */
  const receive = async (req: IncomingMessage, file: string) => {
    try {
      await pipeline(req, createWriteStream(file));
    } catch (error) {
      removeQuietly(file);
      throw error;
    }
  };

  async function uploadVideo(req: IncomingMessage, res: ServerResponse) {
    const name = fileName(req, "video");
    if (Number(req.headers["content-length"] ?? 0) > MAX_VIDEO_BYTES) return json(res, 413, { error: "The video is larger than 8 GB." });
    const id = randomUUID().slice(0, 8);
    const file = path.join(ctx.workDir, `video-${id}${safeExt(name)}`);
    await receive(req, file);
    let info: MediaInfo;
    try {
      info = await probeMedia(file);
    } catch {
      removeQuietly(file);
      return json(res, 400, { error: `Could not read ${name}: it is not a video ffmpeg understands.` });
    }
    if (!info.hasVideo) {
      removeQuietly(file);
      return json(res, 400, { error: `${name} has no picture. Add it to a track as audio instead.`, code: "no-picture" });
    }
    const decision = browserPlays(await pictureFormat(file, info));
    const audio = info.hasAudio ? await ctx.addSource(file, name, MIX_PREVIEW_SECONDS) : null;
    const video: MixVideo = { id, name, file, info, plays: decision.plays, reason: decision.reason, audio, cuts: new Map() };
    videos.set(id, video);
    // Started now so the picture is ready sooner; the picture route waits for it.
    if (!decision.plays) proxyOf(video);
    json(res, 200, {
      id,
      name,
      duration: info.duration,
      width: info.width ?? null,
      height: info.height ?? null,
      fps: info.fps ?? null,
      codec: info.videoCodec ?? null,
      picture: decision.plays ? "original" : "proxy",
      reason: decision.reason,
      audio: audio && sourceJson(audio),
    });
  }

  async function videoRoute(req: IncomingMessage, res: ServerResponse, url: URL, video: MixVideo, part: string | undefined) {
    const method = req.method ?? "GET";
    if (!part && method === "DELETE") {
      videos.delete(video.id);
      removeQuietly(video.file);
      const proxy = await video.proxy?.catch(() => null);
      if (proxy) removeQuietly(proxy.file);
      return json(res, 200, { ok: true });
    }
    if (part === "picture" && (method === "GET" || method === "HEAD")) {
      if (!video.proxy) return sendFile(req, res, video.file, VIDEO_MIME[path.extname(video.file).toLowerCase()] ?? "application/octet-stream");
      let proxy: { file: string };
      try {
        proxy = await video.proxy;
      } catch (error) {
        return json(res, 500, { error: (error as Error).message });
      }
      return sendFile(req, res, proxy.file, proxy.file.endsWith(".webm") ? "video/webm" : "video/mp4");
    }
    if (part === "proxy" && method === "POST") {
      // Also asked by the browser when it cannot play an original the probe said it would.
      try {
        return json(res, 200, { encoder: (await proxyOf(video)).encoder });
      } catch (error) {
        return json(res, 500, { error: (error as Error).message });
      }
    }
    if (part === "cuts" && method === "GET") {
      const threshold = Number(url.searchParams.get("threshold") ?? 10);
      let cuts = video.cuts.get(threshold);
      if (!cuts) {
        cuts = detectCuts(video.file, { threshold });
        video.cuts.set(threshold, cuts);
        cuts.catch(() => video.cuts.delete(threshold));
      }
      try {
        return json(res, 200, { threshold, cuts: await cuts });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    json(res, 405, { error: "Method not allowed." });
  }

  async function addAudio(res: ServerResponse, input: string, name: string) {
    json(res, 200, sourceJson(await ctx.addSource(input, name, MIX_PREVIEW_SECONDS)));
  }

  async function render(req: IncomingMessage, res: ServerResponse) {
    const body = (await readJson(req)) as { project?: unknown } | null;
    const t = Date.now();
    const project = previewOf(mapProject(body?.project, lookup), videoOf(body?.project));
    const wav = await renderMix(project, "buffer", { resolveLibrary });
    const id = randomUUID().slice(0, 8);
    renders.set(id, { wav });
    while (renders.size > KEPT_RENDERS) renders.delete(renders.keys().next().value!);
    res.writeHead(200, {
      "content-type": "audio/wav",
      "content-length": wav.length,
      "x-render-ms": String(Date.now() - t),
      "x-render-id": id,
    });
    res.end(wav);
  }

  async function analysis(res: ServerResponse, id: string) {
    const entry = renders.get(id);
    if (!entry) return json(res, 404, { error: "That render is gone: a newer one replaced it." });
    entry.analysis ??= (async () => {
      const file = path.join(ctx.workDir, `analysis-${id}.wav`);
      writeFileSync(file, entry.wav);
      try {
        return await analyzeFile(file);
      } finally {
        removeQuietly(file);
      }
    })();
    json(res, 200, await entry.analysis);
  }

  async function exportMix(req: IncomingMessage, res: ServerResponse) {
    const body = (await readJson(req)) as { project?: unknown; kind?: unknown } | null;
    const kind = body?.kind === "video" ? "video" : "wav";
    const video = videoOf(body?.project);
    if (kind === "video" && !video) throw new Error("Load a video first: its picture is what this export keeps.");
    const project = mapProject(body?.project, lookup);
    const id = randomUUID().slice(0, 8);
    const ext = kind === "video" ? videoExportExt(video!.file) : ".wav";
    const file = path.join(ctx.workDir, `export-${id}${ext}`);
    const t = Date.now();
    // A .wav is written as 24-bit PCM; a video copies the original picture and gets the mix as its audio.
    await renderMix(project, file, { resolveLibrary });
    // One export of each kind is kept: the previous one goes.
    for (const [old, entry] of exported) {
      if (entry.kind !== kind) continue;
      exported.delete(old);
      removeQuietly(entry.file);
    }
    const name = exportName(video?.name, kind);
    exported.set(id, { file, name, kind, type: kind === "video" ? (VIDEO_MIME[ext] ?? "application/octet-stream") : "audio/wav" });
    json(res, 200, { id, name, size: statSync(file).size, ms: Date.now() - t, url: `/api/mix/exports/${id}` });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    const p = url.pathname;
    if (method === "POST" && p === "/api/mix/videos") return uploadVideo(req, res);
    const videoMatch = p.match(/^\/api\/mix\/videos\/([\w-]+)(?:\/(picture|proxy|cuts))?$/);
    if (videoMatch) {
      const video = videos.get(videoMatch[1]);
      if (!video) return json(res, 404, { error: "That video is not loaded any more. Load it again." });
      return videoRoute(req, res, url, video, videoMatch[2]);
    }
    if (method === "POST" && p === "/api/mix/sources") {
      const name = fileName(req, "audio");
      if (Number(req.headers["content-length"] ?? 0) > MAX_AUDIO_BYTES) return json(res, 413, { error: "The file is larger than 2 GB." });
      const raw = path.join(ctx.workDir, `upload-${randomUUID()}${safeExt(name)}`);
      await receive(req, raw);
      try {
        return await addAudio(res, raw, name);
      } catch {
        return json(res, 400, { error: `Could not read ${name}: it is not audio or video ffmpeg understands.` });
      } finally {
        removeQuietly(raw);
      }
    }
    if (method === "POST" && p === "/api/mix/sources/library") {
      const id = url.searchParams.get("id") ?? "";
      const library = ctx.library();
      // Only files the scan listed can be opened: the client never sends paths.
      const file = library.paths.get(id);
      if (!file) return json(res, 404, { error: "That audio is no longer in the library. Refresh the list." });
      let source = librarySources.get(id);
      if (!source) {
        source = await ctx.addSource(file, library.items.find((i) => i.id === id)?.name ?? path.basename(file), MIX_PREVIEW_SECONDS);
        librarySources.set(id, source);
      }
      return json(res, 200, sourceJson(source));
    }
    if (method === "POST" && p === "/api/mix/render") return render(req, res);
    const analysisMatch = p.match(/^\/api\/mix\/renders\/([\w-]+)\/analysis$/);
    if (method === "GET" && analysisMatch) return analysis(res, analysisMatch[1]);
    if (method === "POST" && p === "/api/mix/export") return exportMix(req, res);
    const exportMatch = p.match(/^\/api\/mix\/exports\/([\w-]+)$/);
    if (exportMatch && (method === "GET" || method === "HEAD")) {
      const entry = exported.get(exportMatch[1]);
      if (!entry) return json(res, 404, { error: "That export is gone. Export again." });
      return sendFile(req, res, entry.file, entry.type, entry.name);
    }
    json(res, 404, { error: "Unknown route." });
  }

  /** Answers a request under /api/mix/ (errors as JSON 400) and returns true; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/mix/")) return false;
    try {
      await route(req, res, url);
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: (error as Error).message });
      else res.destroy();
    }
    return true;
  }

  return { handle };
}
