import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { compile, type CompiledGraph } from "./compile.js";
import { SAMPLE_RATE, type CompileOptions, type EffectStep } from "./types.js";

let cached: string | undefined;

/**
 * Looks for ffmpeg in this order: AUDIOFX_FFMPEG, PATH and the imageio-ffmpeg (Python) binary,
 * which is what existing render scripts use.
 */
export function resolveFfmpeg(): string {
  if (cached) return cached;
  const fromEnv = process.env.AUDIOFX_FFMPEG;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`AUDIOFX_FFMPEG points to a file that does not exist: ${fromEnv}`);
    return (cached = fromEnv);
  }
  const probe = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    } catch {
      return "";
    }
  };
  if (probe("ffmpeg", ["-version"]).startsWith("ffmpeg")) return (cached = "ffmpeg");
  for (const python of ["python", "python3", "py"]) {
    const found = probe(python, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]);
    if (found && existsSync(found)) return (cached = found);
  }
  throw new Error(
    "ffmpeg not found. Install it (winget install Gyan.FFmpeg, brew install ffmpeg), or `pip install imageio-ffmpeg`, or set AUDIOFX_FFMPEG to the executable path.",
  );
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export function runFfmpeg(args: string[], input?: Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), ["-hide_banner", "-nostdin", ...args], { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`ffmpeg exited with code ${code}:\n${err.trim().split("\n").slice(-8).join("\n")}`));
    });
    if (input) proc.stdin.end(input);
    else proc.stdin.end();
  });
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

function codecArgs(output: string): string[] {
  const ext = path.extname(output).toLowerCase();
  // For video, -shortest keeps a reverb/echo tail from making the file longer than the picture.
  if (VIDEO_EXT.has(ext)) return ["-map", "0:v?", "-map", "[out]", "-shortest", "-c:v", "copy", "-c:a", ext === ".webm" ? "libopus" : "aac", "-b:a", "256k"];
  const map = ["-map", "[out]", "-vn"];
  switch (ext) {
    case ".wav":
      return [...map, "-c:a", "pcm_s24le"];
    case ".mp3":
      return [...map, "-c:a", "libmp3lame", "-q:a", "2"];
    case ".flac":
      return [...map, "-c:a", "flac"];
    case ".ogg":
    case ".opus":
      return [...map, "-c:a", "libopus", "-b:a", "192k"];
    case ".m4a":
    case ".aac":
      return [...map, "-c:a", "aac", "-b:a", "256k"];
    default:
      throw new Error(`Unsupported output format: "${ext}". Use wav, mp3, flac, ogg, m4a or a video (mp4, mov, mkv, webm).`);
  }
}

/** Turns the -af graph into -filter_complex: labels the input [0:a] and the output [out]. */
function toComplex(graph: string): string {
  return `[0:a]${graph}[out]`;
}

export interface ApplyOptions extends CompileOptions {
  /** Trims the input before processing (seconds). */
  start?: number;
  duration?: number;
}

/** Applies a chain to a file. If the output is a video, copies the picture and replaces the audio. */
export async function applyToFile(input: string, output: string, steps: EffectStep[], options: ApplyOptions = {}): Promise<CompiledGraph> {
  const compiled = compile(steps, options);
  const trim = [
    ...(options.start !== undefined ? ["-ss", String(options.start)] : []),
    ...(options.duration !== undefined ? ["-t", String(options.duration)] : []),
  ];
  await runFfmpeg(["-y", "-v", "error", ...trim, "-i", input, "-filter_complex", toComplex(compiled.graph), ...codecArgs(output), output]);
  return compiled;
}

/** Processes an audio file (any format ffmpeg understands) and returns WAV. Used by the web studio. */
export async function applyToBuffer(input: string, steps: EffectStep[], options: CompileOptions = {}): Promise<Buffer> {
  const compiled = compile(steps, options);
  const { stdout } = await runFfmpeg([
    "-v", "error", "-i", input, "-filter_complex", toComplex(compiled.graph), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", String(SAMPLE_RATE), "-f", "wav", "-",
  ]);
  return stdout;
}

/** Decodes to interleaved stereo float32 at 48 kHz (for tests and analysis). */
export async function decodeFloat32(input: string, graph?: string): Promise<Float32Array> {
  const args = ["-v", "error", "-i", input];
  if (graph) args.push("-af", graph);
  args.push("-f", "f32le", "-ac", "2", "-ar", String(SAMPLE_RATE), "-");
  const { stdout } = await runFfmpeg(args);
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

export interface Analysis {
  duration: number;
  integratedLufs: number | null;
  truePeakDb: number | null;
  peakDb: number | null;
  rmsDb: number | null;
  loudnessRange: number | null;
}

/** Measures integrated loudness (EBU R128), true peak, peak and RMS. */
export async function analyzeFile(input: string): Promise<Analysis> {
  const { stderr } = await runFfmpeg([
    "-v", "info", "-i", input, "-vn", "-af", "ebur128=peak=true:framelog=quiet,astats=measure_perchannel=none", "-f", "null", "-",
  ]);
  const grab = (re: RegExp) => {
    const matches = [...stderr.matchAll(re)];
    if (!matches.length) return null;
    const v = Number(matches[matches.length - 1][1]);
    return Number.isFinite(v) ? v : null;
  };
  const time = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  const duration = time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0;
  return {
    duration,
    integratedLufs: grab(/I:\s+(-?[\d.]+|-inf) LUFS/g),
    loudnessRange: grab(/LRA:\s+(-?[\d.]+) LU/g),
    truePeakDb: grab(/Peak:\s+(-?[\d.]+|-inf) dBFS/g),
    peakDb: grab(/Peak level dB:\s+(-?[\d.]+|-inf)/g),
    rmsDb: grab(/RMS level dB:\s+(-?[\d.]+|-inf)/g),
  };
}
