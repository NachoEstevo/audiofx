import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeFile, decodeFloat32, probeMedia, renderMix, runFfmpeg, type MixProject } from "../src/core/index.js";
import {
  browserPlays,
  contentDisposition,
  createMixApi,
  exportName,
  makeProxy,
  mapProject,
  parseRange,
  pictureFormat,
  pixelFormatOf,
  proxyEncoders,
  type MixLookup,
  type StudioSource,
} from "../src/mix-server.js";
import { makeSignal, rmsDb, tempDir } from "./helpers.js";

const tmp = tempDir();
afterAll(() => tmp.cleanup());

/** A 4 s picture with a hard cut at 2 s (red to blue) and a 440 Hz tone, in the codec and container asked for. */
const cutVideo = (name: string, codec: string[], audio = true) => {
  const file = path.join(tmp.dir, name);
  const graph = "color=c=red:s=160x120:r=25:d=2[v0];color=c=blue:s=160x120:r=25:d=2[v1];[v0][v1]concat=n=2:v=1:a=0[out0]" + (audio ? ";sine=f=440:d=4:r=48000,volume=0.3[out1]" : "");
  return runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", graph, ...codec, ...(audio ? ["-c:a", "aac", "-shortest"] : []), file]).then(() => file);
};

let h264: string;
let h264Mov: string;
let h264Hi422: string;
let mpeg4: string;
let vp9: string;
let click: string;
let tone: string;

beforeAll(async () => {
  [h264, h264Mov, h264Hi422, mpeg4, vp9, click, tone] = await Promise.all([
    cutVideo("h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    cutVideo("h264.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    cutVideo("h264-422.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv422p"]),
    cutVideo("mpeg4.mp4", ["-c:v", "mpeg4", "-q:v", "5"]),
    cutVideo("vp9.webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"], false),
    makeSignal(tmp.dir, "click", "anoisesrc=d=0.4:c=pink:a=0.6:r=48000:seed=3"),
    makeSignal(tmp.dir, "tone", "sine=f=110:d=3:r=48000,volume=0.25"),
  ]);
});

describe("Range requests", () => {
  it("reads a range, an open end and a suffix, clamped to the file", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange(" bytes=0-0 ", 1)).toEqual({ start: 0, end: 0 });
  });

  it("answers unsatisfiable past the end, and ignores what it cannot serve as one range", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=1000-1100", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
    for (const ignored of [undefined, "", "bytes=5-2", "bytes=-", "items=0-5", "bytes=0-5,10-20", "bytes=abc"]) {
      expect(parseRange(ignored, 1000), String(ignored)).toBeNull();
    }
  });
});

describe("which pictures a browser plays", () => {
  it("decides from the container, codec and pixel format of real files", async () => {
    const plays = async (file: string) => browserPlays(await pictureFormat(file));
    expect(await plays(h264)).toEqual({ plays: true, reason: "H.264 in MP4" });
    expect((await plays(h264Mov)).plays).toBe(true);
    expect((await plays(vp9)).plays).toBe(true);
    const hi422 = await plays(h264Hi422);
    expect(hi422.plays).toBe(false);
    expect(hi422.reason).toMatch(/yuv422p/);
    const part2 = await plays(mpeg4);
    expect(part2).toEqual({ plays: false, reason: "Browsers do not play MPEG-4 Part 2 in MP4." });
  });

  it("names what it rejects", () => {
    expect(browserPlays({ container: ".mov", codec: "prores", pixelFormat: "yuv422p10le" }).reason).toBe("Browsers do not play ProRes in MOV.");
    expect(browserPlays({ container: ".mp4", codec: "hevc" }).plays).toBe(false);
    expect(browserPlays({ container: ".mov", codec: "vp9" }).plays).toBe(false);
    expect(browserPlays({ container: ".mxf", codec: "dnxhd" }).reason).toBe("Browsers do not open MXF files.");
    expect(browserPlays({ container: ".mp4", codec: "h264", pixelFormat: "yuv420p10le" }).plays).toBe(false);
    expect(browserPlays({ container: ".webm", codec: "vp9", pixelFormat: "yuv420p10le" }).plays).toBe(true);
    expect(browserPlays({ container: ".mp4" }).plays).toBe(false);
  });

  it("reads the pixel format of the first picture, not of cover art", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':",
      "  Stream #0:0[0x1](und): Video: h264 (High 4:2:2 Intra) (avc1 / 0x31637661), yuv422p10le(tv, bt709, progressive), 3840x2160, 25 fps",
      "  Stream #0:1[0x2](und): Audio: pcm_s24le (in24 / 0x34326E69), 48000 Hz, stereo, s32 (24 bit)",
    ].join("\n");
    expect(pixelFormatOf(stderr)).toBe("yuv422p10le");
    expect(pixelFormatOf("  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 (attached pic)")).toBeUndefined();
    expect(pixelFormatOf("  Stream #0:0: Audio: aac, 48000 Hz")).toBeUndefined();
  });
});

describe("browser proxy", () => {
  it("lists only the encoders this ffmpeg has, H.264 first", () => {
    const listing = [
      "Encoders:",
      " V..... = Video",
      " ------",
      " V....D libvpx-vp9           libvpx VP9 (codec vp9)",
      " V....D h264_mf              H264 via MediaFoundation (codec h264)",
      " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC (codec h264)",
      " A....D aac                  AAC (Advanced Audio Coding)",
    ].join("\n");
    expect(proxyEncoders(listing).map((e) => e.name)).toEqual(["libx264", "h264_mf", "libvpx-vp9"]);
    expect(proxyEncoders(" A....D aac  AAC")).toEqual([]);
  });

  it("makes a small H.264 picture with the original's timeline and no audio", async () => {
    const { file, encoder } = await makeProxy(mpeg4, path.join(tmp.dir, "proxy"));
    expect(encoder).toBe("libx264");
    const info = await probeMedia(file);
    expect(info).toMatchObject({ hasVideo: true, hasAudio: false, videoCodec: "h264", width: 160, height: 120, fps: 25 });
    expect(info.duration).toBeCloseTo(4, 1);
    expect(browserPlays(await pictureFormat(file)).plays).toBe(true);
  });
});

describe("mapping a project from the browser", () => {
  const lookup: MixLookup = {
    source: (id) => ({ s1: click, s2: tone })[id],
    video: (id) => (id === "v1" ? h264 : undefined),
    library: (id) => (id === "lib1" ? click : undefined),
  };
  const project = (extra: Partial<MixProject> = {}, file = "s1"): unknown => ({
    version: 1,
    tracks: [{ id: "fx", role: "sfx", clips: [{ file, at: 1 }] }],
    master: { loudness: null },
    ...extra,
  });

  it("turns source ids, library references and the video id into files", () => {
    const mapped = mapProject(
      project({
        video: "v1",
        tracks: [
          { id: "music", role: "music", duck: { depth: 12 }, clips: [{ file: "s2", gain: -3 }] },
          { id: "fx", role: "sfx", clips: [{ file: "library:lib1", at: 2, align: "onset" }], steps: [{ effect: "layer", params: { file: "library:lib1", at: 1 } }] },
        ],
      }),
      lookup,
    );
    expect(mapped.video).toBe(h264);
    expect(mapped.tracks[0]).toMatchObject({ id: "music", duck: { depth: 12 }, clips: [{ file: tone, gain: -3 }] });
    expect(mapped.tracks[1].clips[0]).toMatchObject({ file: click, at: 2, align: "onset" });
    // Samples inside chains stay references: prepareMix resolves them with the library.
    expect(mapped.tracks[1].steps![0].params!.file).toBe("library:lib1");
  });

  it("rejects paths, ids it did not issue and samples outside the library", () => {
    for (const file of [click, "C:\\Windows\\win.ini", "../secret.wav", "/etc/passwd", "s9", "library:nope"]) {
      expect(() => mapProject(project({}, file), lookup), file).toThrow(/clip 1/);
    }
    expect(() => mapProject(project({ video: h264 }), lookup)).toThrow(/video/);
    expect(() => mapProject(project({ video: "v2" }), lookup)).toThrow(/video/);
    const withLayer = (file: string) => project({ tracks: [{ id: "fx", role: "sfx", clips: [{ file: "s1", steps: [{ effect: "layer", params: { file } }] }] }] });
    expect(() => mapProject(withLayer(click), lookup)).toThrow(/pick a sample from the library/);
    expect(() => mapProject(withLayer("library:nope"), lookup)).toThrow(/no longer in the library/);
    expect(() => mapProject(project({ master: { steps: [{ effect: "nope" }] } }), lookup)).toThrow(/Unknown effect/);
    expect(() => mapProject({ version: 1 }, lookup)).toThrow(/tracks/);
    expect(() => mapProject(null, lookup)).toThrow(/must be an object/);
  });

  it("renders what it maps", async () => {
    const mapped = mapProject(project({ duration: 2 }), lookup);
    const wav = await renderMix(mapped, "buffer", { resolveLibrary: lookup.library });
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  });
});

describe("export names", () => {
  it("keeps the video's name and container when it can", () => {
    expect(exportName("interview take 2.mp4", "video")).toBe("interview take 2 (mix).mp4");
    expect(exportName("interview take 2.mp4", "wav")).toBe("interview take 2 mix.wav");
    expect(exportName("A001.MXF", "video")).toBe("A001 (mix).mkv");
    expect(exportName("clip.MOV", "video")).toBe("clip (mix).mov");
    expect(exportName(undefined, "wav")).toBe("AudioFX mix.wav");
    expect(exportName('a:b*"c.mp4', "video")).toBe("abc (mix).mp4");
  });

  it("writes a Content-Disposition with an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("Entrevista (mix).mp4")).toBe(`attachment; filename="Entrevista (mix).mp4"; filename*=UTF-8''Entrevista%20%28mix%29.mp4`);
    expect(contentDisposition("Canción.wav")).toBe(`attachment; filename="Canci_n.wav"; filename*=UTF-8''Canci%C3%B3n.wav`);
  });
});

describe("the Mix API over HTTP", () => {
  let server: Server;
  let base: string;
  const sources = new Map<string, StudioSource>();

  beforeAll(async () => {
    let n = 0;
    const api = createMixApi({
      workDir: tmp.dir,
      sources,
      library: () => ({ items: [], paths: new Map() }),
      async addSource(input, name, maxSeconds) {
        const id = `src${++n}`;
        const file = path.join(tmp.dir, `${id}.wav`);
        await runFfmpeg(["-y", "-v", "error", "-i", input, "-vn", "-t", String(maxSeconds), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", file]);
        const source = { id, name, file, duration: (await analyzeFile(file)).duration };
        sources.set(id, source);
        return source;
      },
    });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      void api.handle(req, res, url).then((handled) => handled || res.writeHead(404).end());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const upload = (file: string, name = path.basename(file)) =>
    fetch(`${base}/api/mix/videos`, { method: "POST", headers: { "x-filename": encodeURIComponent(name) }, body: readFileSync(file) });

  it("keeps a video, serves its picture with Range and finds its cuts", async () => {
    const res = await upload(h264, "cut.mp4");
    expect(res.status).toBe(200);
    const video = await res.json();
    expect(video).toMatchObject({ name: "cut.mp4", duration: 4, width: 160, height: 120, fps: 25, codec: "h264", picture: "original" });
    expect(video.audio.duration).toBeCloseTo(4, 1);
    expect(sources.has(video.audio.id)).toBe(true);

    const size = readFileSync(h264).length;
    const whole = await fetch(`${base}/api/mix/videos/${video.id}/picture`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await whole.arrayBuffer()).equals(readFileSync(h264))).toBe(true);

    const part = await fetch(`${base}/api/mix/videos/${video.id}/picture`, { headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${size}`);
    expect(part.headers.get("content-length")).toBe("100");
    expect(Buffer.from(await part.arrayBuffer()).equals(readFileSync(h264).subarray(100, 200))).toBe(true);

    const past = await fetch(`${base}/api/mix/videos/${video.id}/picture`, { headers: { range: `bytes=${size}-` } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe(`bytes */${size}`);

    const { cuts } = await (await fetch(`${base}/api/mix/videos/${video.id}/cuts?threshold=10`)).json();
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBeCloseTo(2, 1);
  });

  it("serves a proxy for a picture browsers do not play, and exports the original with the mix", async () => {
    const video = await (await upload(mpeg4, "old camera.mp4")).json();
    expect(video).toMatchObject({ picture: "proxy", reason: "Browsers do not play MPEG-4 Part 2 in MP4." });
    const picture = await fetch(`${base}/api/mix/videos/${video.id}/picture`, { headers: { range: "bytes=0-" } });
    expect(picture.status).toBe(206);
    const proxy = path.join(tmp.dir, "served-proxy.mp4");
    writeFileSync(proxy, Buffer.from(await picture.arrayBuffer()));
    expect(await probeMedia(proxy)).toMatchObject({ videoCodec: "h264", hasAudio: false });

    // The video's own audio is a source like any upload: here it is the clip, landed 1 s late.
    const project = { version: 1, video: video.id, tracks: [{ id: "cam", role: "voice", clips: [{ file: video.audio.id, at: 1 }] }], master: { loudness: null } };
    const preview = await fetch(`${base}/api/mix/render`, { method: "POST", body: JSON.stringify({ project }) });
    expect(preview.status).toBe(200);
    expect(Number(preview.headers.get("x-render-ms"))).toBeGreaterThan(0);
    const analysis = await (await fetch(`${base}/api/mix/renders/${preview.headers.get("x-render-id")}/analysis`)).json();
    expect(analysis.duration).toBeCloseTo(4, 1);
    expect(analysis.integratedLufs).toBeLessThan(0);

    const made = await (await fetch(`${base}/api/mix/export`, { method: "POST", body: JSON.stringify({ project, kind: "video" }) })).json();
    expect(made.name).toBe("old camera (mix).mp4");
    const download = await fetch(`${base}${made.url}`);
    expect(download.headers.get("content-disposition")).toContain('filename="old camera (mix).mp4"');
    const out = path.join(tmp.dir, "exported.mp4");
    writeFileSync(out, Buffer.from(await download.arrayBuffer()));
    const info = await probeMedia(out);
    // The original picture (MPEG-4 Part 2, untouched), the picture's length, and the mix as its audio.
    expect(info).toMatchObject({ videoCodec: "mpeg4", hasAudio: true, audioCodec: "aac" });
    expect(info.duration).toBeCloseTo(4, 1);
    const audio = await decodeFloat32(out);
    // The tone is lavfi's sine at 0.3 (about -34 dBFS once mono is spread over two channels).
    expect(rmsDb(audio, 0.1, 0.9)).toBeLessThan(-60);
    expect(rmsDb(audio, 1.2, 3.8)).toBeGreaterThan(-40);

    const wav = await (await fetch(`${base}/api/mix/export`, { method: "POST", body: JSON.stringify({ project, kind: "wav" }) })).json();
    const wavFile = path.join(tmp.dir, "exported.wav");
    writeFileSync(wavFile, Buffer.from(await (await fetch(`${base}${wav.url}`)).arrayBuffer()));
    expect(await probeMedia(wavFile)).toMatchObject({ audioCodec: "pcm_s24le", hasVideo: false });
  });

  it("rejects paths and unknown ids with a 400 and a reason", async () => {
    const res = await fetch(`${base}/api/mix/render`, {
      method: "POST",
      body: JSON.stringify({ project: { version: 1, tracks: [{ id: "fx", role: "sfx", clips: [{ file: click }] }] } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not audio this studio loaded/);
    expect((await fetch(`${base}/api/mix/videos/nope/picture`)).status).toBe(404);
    const noPicture = await upload(tone, "tone.wav");
    expect(noPicture.status).toBe(400);
    expect((await noPicture.json()).code).toBe("no-picture");
  });
});
