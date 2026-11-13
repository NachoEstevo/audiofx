import { useEffect, useState } from "react";
import type { GenerateRequest } from "@/components/generate-panel";
import type { MixProject } from "../../src/core/mix";
import type { Align, Cut } from "./mix-store";

/** The Mix screen's calls to the studio server (src/mix-server.ts) and the clip waveforms it decodes. */

export interface AudioSource {
  id: string;
  name: string;
  duration: number;
  /** The server kept only the first 600 s of a longer file. */
  truncated?: boolean;
}

export interface VideoInfo {
  id: string;
  name: string;
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  /** "proxy": browsers do not play the original, so the screen shows a small H.264 copy (the export keeps the original). */
  picture: "original" | "proxy";
  reason: string;
  /** The video's own sound as an audio source: the A/B original, and a clip if you want it. */
  audio: AudioSource | null;
}

/** What the server measures on a render (ffmpeg ebur128 and astats). */
export interface Analysis {
  duration: number;
  integratedLufs: number | null;
  truePeakDb: number | null;
  peakDb: number | null;
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.json();
    } catch {
      // Not JSON: the status says enough.
    }
    throw new RequestError(body.error ?? res.statusText, body.code);
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Uploads a video with progress (a camera file can be gigabytes; fetch cannot report upload progress). */
export function uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/mix/videos");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new RequestError("The studio server is not reachable."));
    xhr.onload = () => {
      let body: { error?: string; code?: string } & Partial<VideoInfo> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Handled below by the status.
      }
      if (xhr.status === 200) resolve(body as VideoInfo);
      else reject(new RequestError(body.error ?? `Upload failed (${xhr.status}).`, body.code));
    };
    xhr.send(file);
  });
}

export const pictureUrl = (id: string, version = 0) => `/api/mix/videos/${id}/picture${version ? `?v=${version}` : ""}`;
export const ensureProxy = (id: string) => post(`/api/mix/videos/${id}/proxy`).then((r) => ok<{ encoder: string }>(r));
export const dropVideo = (id: string) => void fetch(`/api/mix/videos/${id}`, { method: "DELETE" }).catch(() => {});
export const fetchCuts = (id: string, threshold: number) =>
  fetch(`/api/mix/videos/${id}/cuts?threshold=${threshold}`)
    .then((r) => ok<{ cuts: Cut[] }>(r))
    .then((r) => r.cuts);

export const uploadAudio = (file: File) =>
  fetch("/api/mix/sources", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file }).then((r) => ok<AudioSource>(r));
export const libraryAudio = (id: string) => post(`/api/mix/sources/library?id=${encodeURIComponent(id)}`).then((r) => ok<AudioSource>(r));
export const demoAudio = (kind: string) => post(`/api/sources/demo?kind=${encodeURIComponent(kind)}`).then((r) => ok<AudioSource>(r));
export const generateAudio = (request: GenerateRequest) => post("/api/sources/elevenlabs", request).then((r) => ok<AudioSource & { libraryId: string | null }>(r));

export async function renderPreview(project: MixProject, signal: AbortSignal): Promise<{ data: ArrayBuffer; ms: number; id: string }> {
  const res = await fetch("/api/mix/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project }), signal });
  if (!res.ok) await ok(res);
  return { data: await res.arrayBuffer(), ms: Number(res.headers.get("x-render-ms")), id: res.headers.get("x-render-id") ?? "" };
}

export const fetchAnalysis = (renderId: string) => fetch(`/api/mix/renders/${renderId}/analysis`).then((r) => ok<Analysis>(r));

export const exportMix = (project: MixProject, kind: "wav" | "video") =>
  post("/api/mix/export", { project, kind }).then((r) => ok<{ id: string; name: string; size: number; url: string }>(r));

/** Starts a download the browser streams to disk (no blob of a large video in memory). */
export function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------------------------------------
// Waveforms

const BLOCK = 0.005;

/** A clip's file as the timeline draws it: peaks for the waveform and 5 ms energies for sync points. */
export interface Wave {
  duration: number;
  /** Absolute peak per point, normalized to the loudest point of the file. */
  peaks: Float32Array;
  perSecond: number;
  /** Energy per 5 ms block (all channels), as `syncPoints` measures it on the server. */
  energy: Float32Array;
}

const waves = new Map<string, Promise<Wave>>();

function analyse(buffer: AudioBuffer): Wave {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const perSecond = Math.max(10, Math.min(200, 12000 / Math.max(buffer.duration, 0.01)));
  const count = Math.max(1, Math.ceil(buffer.duration * perSecond));
  const peaks = new Float32Array(count);
  const per = buffer.sampleRate / perSecond;
  let max = 0;
  for (let p = 0; p < count; p++) {
    const end = Math.min(buffer.length, Math.floor((p + 1) * per));
    let peak = 0;
    for (const ch of channels) for (let i = Math.floor(p * per); i < end; i += 2) peak = Math.max(peak, Math.abs(ch[i]));
    peaks[p] = peak;
    max = Math.max(max, peak);
  }
  const scale = 1 / Math.max(0.05, max);
  for (let p = 0; p < count; p++) peaks[p] = Math.min(1, peaks[p] * scale);
  const block = Math.round(buffer.sampleRate * BLOCK);
  const energy = new Float32Array(Math.floor(buffer.length / block));
  for (let b = 0; b < energy.length; b++) {
    let s = 0;
    for (const ch of channels) for (let i = b * block; i < (b + 1) * block; i++) s += ch[i] * ch[i];
    energy[b] = s;
  }
  return { duration: buffer.duration, peaks, perSecond, energy };
}

export function loadWave(sourceId: string, ctx: BaseAudioContext): Promise<Wave> {
  let wave = waves.get(sourceId);
  if (!wave) {
    wave = fetch(`/api/sources/${sourceId}.wav`)
      .then((r) => {
        if (!r.ok) throw new Error("The audio is gone from the server.");
        return r.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then(analyse);
    waves.set(sourceId, wave);
    wave.catch(() => waves.delete(sourceId));
  }
  return wave;
}

/** The waveform of a source, once decoded (null meanwhile). */
export function useWave(sourceId: string, ctx: BaseAudioContext): Wave | null {
  const [wave, setWave] = useState<{ id: string; wave: Wave } | null>(null);
  useEffect(() => {
    let live = true;
    loadWave(sourceId, ctx).then(
      (w) => live && setWave({ id: sourceId, wave: w }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [sourceId, ctx]);
  return wave?.id === sourceId ? wave.wave : null;
}

/**
 * Seconds into the stretch [start, start + length] of the file where the attack (onset: first 5 ms block
 * above 1/16 of the loudest one's energy) or the loudest block (peak) is: the same rule as the server.
 */
export function syncOffset(wave: Wave | null, start: number, length: number, align: Align): number {
  if (!wave || align === "start") return 0;
  const a = Math.floor(start / BLOCK);
  const b = Math.min(wave.energy.length, Math.floor((start + Math.min(length, 60)) / BLOCK));
  let max = 0;
  let loudest = a;
  for (let i = a; i < b; i++) {
    if (wave.energy[i] > max) {
      max = wave.energy[i];
      loudest = i;
    }
  }
  if (max <= 0) return 0;
  if (align === "peak") return (loudest - a) * BLOCK;
  for (let i = a; i < b; i++) if (wave.energy[i] > max / 16) return (i - a) * BLOCK;
  return 0;
}
