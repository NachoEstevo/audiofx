import { execFfmpeg, runFfmpeg } from "./ffmpeg.js";

/**
 * What a media file holds, read from `ffmpeg -i` (there is no ffprobe in every install). Used by the mix
 * engine to place clips and keep a video's picture, and by `sfx cuts` to find edit points.
 */
export interface MediaInfo {
  /** Seconds. Measured by decoding when the container does not say. */
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Codec of the first video stream, e.g. "h264". */
  videoCodec?: string;
  /** Codec of the first audio stream, e.g. "aac". */
  audioCodec?: string;
  width?: number;
  height?: number;
  /** Frames per second of the first video stream. */
  fps?: number;
}

const toSeconds = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** The last progress time ffmpeg printed (`time=00:00:04.00`): how much it decoded. */
function decodedSeconds(stderr: string): number {
  const time = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  return time ? toSeconds(time[1], time[2], time[3]) : 0;
}

/** Reads duration, streams, size and frame rate of a media file. */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const { stderr } = await execFfmpeg(["-i", file]);
  if (!/^Input #0/m.test(stderr)) {
    const reason = stderr.trim().split("\n").pop() ?? "unknown error";
    throw new Error(`Could not read ${file}: ${reason}`);
  }
  // Only the first input's streams; cover art in an mp3 or m4a ("attached pic") is not video.
  const streams = [...stderr.matchAll(/^\s*Stream #0:\d+.*?: (Video|Audio): (\w+)(.*)$/gm)].filter((s) => !/attached pic/.test(s[3]));
  const video = streams.find((s) => s[1] === "Video");
  const audio = streams.find((s) => s[1] === "Audio");
  const info: MediaInfo = { duration: 0, hasVideo: !!video, hasAudio: !!audio };
  if (video) {
    info.videoCodec = video[2];
    const size = /, (\d{2,5})x(\d{2,5})/.exec(video[3]);
    if (size) [info.width, info.height] = [Number(size[1]), Number(size[2])];
    const rate = /([\d.]+)(k?) fps/.exec(video[3]) ?? /([\d.]+)(k?) tbr/.exec(video[3]);
    if (rate) info.fps = Number(rate[1]) * (rate[2] ? 1000 : 1);
  }
  if (audio) info.audioCodec = audio[2];

  const stated = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (stated) info.duration = toSeconds(stated[1], stated[2], stated[3]);
  if (!info.duration && (video || audio)) {
    // "Duration: N/A" (a stream written to a pipe, raw formats): decode one stream to the end and time it.
    const only = audio ? ["-map", "0:a:0"] : ["-map", "0:v:0"];
    const { stderr: decoded } = await runFfmpeg(["-v", "info", "-i", file, ...only, "-f", "null", "-"]);
    info.duration = decodedSeconds(decoded);
  }
  return info;
}

/** A hard cut in a video. */
export interface Cut {
  /** Second of the video where the new shot starts. */
  time: number;
  /** How different the frame is from the previous one (0–100); scdet's threshold defaults to 10. */
  score: number;
}

/**
 * Finds hard cuts with ffmpeg's `scdet` (scene change detection) on a picture downscaled to 320 px wide,
 * which is enough to see a shot change and much faster on 4K footage.
 */
export async function detectCuts(file: string, options: { threshold?: number } = {}): Promise<Cut[]> {
  const threshold = options.threshold ?? 10;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) throw new Error("The cut threshold must be between 0 and 100.");
  const { code, stderr } = await execFfmpeg([
    "-v", "info", "-i", file, "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", `scale='min(320,iw)':-2,scdet=threshold=${threshold}`, "-f", "null", "-",
  ]);
  if (code !== 0) {
    if (/matches no streams/.test(stderr)) throw new Error(`${file} has no video to find cuts in.`);
    throw new Error(`Could not read ${file}: ${stderr.trim().split("\n").pop()}`);
  }
  return [...stderr.matchAll(/lavfi\.scd\.score: ([\d.]+), lavfi\.scd\.time: ([\d.]+)/g)].map((m) => ({ time: Number(m[2]), score: Number(m[1]) }));
}
