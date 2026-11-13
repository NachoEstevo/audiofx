import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeFile,
  compileMix,
  decodeFloat32,
  detectCuts,
  prepareMix,
  probeMedia,
  renderMix,
  runFfmpeg,
  syncPoints,
  type MixProject,
  type MixTrack,
  type PrepareMixOptions,
} from "../src/core/index.js";
import { makeSignal, nonFinite, rmsDb, seconds, tempDir } from "./helpers.js";

const tmp = tempDir();
afterAll(() => tmp.cleanup());

let music: string;
let loudVoice: string;
let quietVoice: string;
let click: string;
let late: string;
let noise: string;
let video: string;
let silentVideo: string;

/** Music is a 110 Hz tone and the voice lives above 1 kHz, so each can be measured inside the mix. */
const MUSIC_BAND = "lowpass=f=300,lowpass=f=300,lowpass=f=300,lowpass=f=300";
const VOICE_BAND = "highpass=f=600,highpass=f=600,highpass=f=600,highpass=f=600";
/** Speech-like: noise above 1 kHz with syllables (4 Hz), 3 s. Gain 3 is about -22 dBFS RMS. */
const speech = (gain: number) =>
  `anoisesrc=d=3:c=pink:a=0.5:r=48000:seed=2,highpass=f=1000,highpass=f=1000,volume='${gain}*(0.6+0.4*sin(2*PI*4*t))':eval=frame`;

beforeAll(async () => {
  [music, loudVoice, quietVoice, click, late, noise] = await Promise.all([
    makeSignal(tmp.dir, "music", "sine=f=110:d=10:r=48000,volume=0.25"),
    // A loud and a quiet voice, 20 dB apart (about -22 and -42 dBFS RMS), both above the -45 dBFS duck threshold.
    makeSignal(tmp.dir, "voice-loud", speech(3)),
    makeSignal(tmp.dir, "voice-quiet", speech(0.3)),
    makeSignal(tmp.dir, "click", "anoisesrc=d=0.4:c=pink:a=0.6:r=48000:seed=3"),
    makeSignal(tmp.dir, "late", "anoisesrc=d=0.4:c=pink:a=0.6:r=48000:seed=3,adelay=delays=300:all=1"),
    makeSignal(tmp.dir, "noise", "anoisesrc=d=4:c=pink:a=0.3:r=48000:seed=7"),
  ]);
  // A 4 s picture with a hard cut at 2 s (red to blue) and its own 440 Hz audio; and one without audio.
  video = path.join(tmp.dir, "cut.mp4");
  silentVideo = path.join(tmp.dir, "silent.mp4");
  await Promise.all([
    runFfmpeg([
      "-y", "-v", "error", "-f", "lavfi",
      "-i", "color=c=red:s=160x120:r=25:d=2[v0];color=c=blue:s=160x120:r=25:d=2[v1];[v0][v1]concat=n=2:v=1:a=0[out0];sine=f=440:d=4:r=48000,volume=0.3[out1]",
      "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", video,
    ]),
    runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=160x120:r=25:d=3", "-c:v", "mpeg4", silentVideo]),
  ]);
});

let renders = 0;
async function render(project: MixProject, options?: PrepareMixOptions, ext = ".wav"): Promise<string> {
  const out = path.join(tmp.dir, `mix-${++renders}${ext}`);
  await renderMix(project, out, options);
  return out;
}
const decode = (file: string, band?: string) => decodeFloat32(file, band);

const musicTrack = (extra: Partial<MixTrack> = {}): MixTrack => ({ id: "music", role: "music", clips: [{ file: music }], ...extra });
const voiceTrack = (file: string, extra: Partial<MixTrack> = {}): MixTrack => ({ id: "voice", role: "voice", clips: [{ file, at: 3 }], ...extra });
/** Music (0–10 s) under a voice (3–6 s), no loudness normalization so levels can be compared. */
const duckProject = (voice: string, music: Partial<MixTrack> = {}, voiceExtra: Partial<MixTrack> = {}): MixProject => ({
  version: 1,
  tracks: [musicTrack(music), voiceTrack(voice, voiceExtra)],
  master: { loudness: null },
});

/** Labels a filter_complex produces, and named filter instances: each must be unique. */
function graphNames(graph: string) {
  const chains: string[] = [];
  let quoted = false;
  let current = "";
  for (let i = 0; i < graph.length; i++) {
    const c = graph[i];
    if (c === "\\") {
      current += c + (graph[++i] ?? "");
      continue;
    }
    if (c === "'") quoted = !quoted;
    if (c === ";" && !quoted) {
      chains.push(current);
      current = "";
    } else current += c;
  }
  chains.push(current);
  const outputs = chains.flatMap((ch) => [.../((?:\[[^\]]+\])+)$/.exec(ch)?.[1].matchAll(/\[([^\]]+)\]/g) ?? []].map((m) => m[1]));
  const instances = [...graph.matchAll(/(?:^|[;,\]])\s*([a-z]+@[\w]+)=/g)].map((m) => m[1]);
  return { outputs, instances };
}

describe("clips on the timeline", () => {
  it("lands a clip on `at` and trims its head with `start`", async () => {
    const project = (clip: MixTrack["clips"][number]): MixProject => ({
      version: 1,
      duration: 4,
      tracks: [{ id: "fx", role: "sfx", clips: [clip] }],
      master: { loudness: null },
    });
    expect(syncPoints(await decode(await render(project({ file: click, at: 1.5 })))).onset).toBeCloseTo(1.5, 2);
    expect(syncPoints(await decode(await render(project({ file: late, at: 2 })))).onset).toBeCloseTo(2.3, 2);
    expect(syncPoints(await decode(await render(project({ file: late, at: 2, start: 0.3 })))).onset).toBeCloseTo(2, 2);
    // align=onset measures the attack and puts it on `at`, like the layer effect.
    expect(syncPoints(await decode(await render(project({ file: late, at: 2, align: "onset" })))).onset).toBeCloseTo(2, 2);
  });

  it("applies length, gain and fades", async () => {
    const project = (clip: Partial<MixTrack["clips"][number]>): MixProject => ({
      version: 1,
      duration: 4,
      tracks: [{ id: "fx", role: "sfx", clips: [{ file: noise, at: 1, start: 0.5, ...clip }] }],
      master: { loudness: null },
    });
    const plain = await decode(await render(project({})));
    const shaped = await decode(await render(project({ length: 2, gain: -6, fadeIn: 0.2, fadeOut: 0.2 })));
    expect(seconds(shaped)).toBeCloseTo(4, 3);
    expect(rmsDb(shaped, 0, 0.99)).toBeLessThan(-90);
    expect(rmsDb(plain, 1.4, 2.6) - rmsDb(shaped, 1.4, 2.6)).toBeCloseTo(6, 0);
    expect(rmsDb(shaped, 3.01, 4)).toBeLessThan(-90);
    expect(rmsDb(shaped, 1.4, 2.6) - rmsDb(shaped, 1, 1.03)).toBeGreaterThan(10);
    expect(rmsDb(shaped, 1.4, 2.6) - rmsDb(shaped, 2.97, 3)).toBeGreaterThan(10);
  });

  it("compiles several clips and tracks with chains without label collisions, and renders clean", async () => {
    const project: MixProject = {
      version: 1,
      tracks: [
        musicTrack({ steps: [{ effect: "lowpass", params: { freq: 2000 } }, { effect: "riser", params: { at: 3 } }] }),
        voiceTrack(loudVoice, {
          clips: [
            { file: loudVoice, at: 1, steps: [{ effect: "reverb" }, { effect: "underwater", from: 0.5, to: 1.5 }] },
            { file: quietVoice, at: 5, steps: [{ effect: "am-radio" }, { effect: "riser", params: { at: 1 } }] },
          ],
          steps: [{ effect: "voice-clean" }],
        }),
        { id: "fx", role: "sfx", clips: [{ file: click, at: 2, steps: [{ effect: "whoosh", params: { at: 0.2 } }] }], steps: [{ effect: "hit", params: { at: 7 } }] },
      ],
      master: { steps: [{ effect: "compressor" }], loudness: null },
    };
    const prepared = await prepareMix(project);
    const { filterComplex, inputs, duration } = compileMix(prepared.project, prepared.media);
    expect(inputs).toHaveLength(4);
    // The last clip (5 s + 3 s) carries a riser, whose chain adds a 3 s tail.
    expect(duration).toBe(11);
    const { outputs, instances } = graphNames(filterComplex);
    expect(new Set(outputs).size).toBe(outputs.length);
    // Two risers and a whoosh, each in its own chain: one swept bandpass name per chain (a riser's two
    // noise channels share theirs on purpose, so both get the same commands).
    const named = [...new Set(instances)];
    expect(named).toHaveLength(3);
    expect(new Set(named.map((i) => /@([a-z0-9]+_)/.exec(i)?.[1])).size).toBe(3);
    const out = await decode(await render(project));
    expect(nonFinite(out)).toBe(0);
    expect(seconds(out)).toBeCloseTo(11, 3);
  });

  it("uses a video's audio as a clip and renders to a WAV buffer for the studio", async () => {
    const wav = await renderMix({ version: 1, tracks: [{ id: "cam", role: "voice", clips: [{ file: video }] }], master: { loudness: null } }, "buffer");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    const { stdout } = await runFfmpeg(["-v", "error", "-i", "-", "-f", "f32le", "-"], wav);
    const x = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
    expect(seconds(x)).toBeCloseTo(4, 2);
    const source = await decode(video);
    expect(Math.abs(rmsDb(x, 0.5, 3.5) - rmsDb(source, 0.5, 3.5))).toBeLessThan(0.2);
  });
});

describe("ducking", () => {
  it("lowers the music by `depth` while the voice plays, however loud the voice is, and brings it back", async () => {
    expect(rmsDb(await decode(loudVoice)) - rmsDb(await decode(quietVoice))).toBeCloseTo(20, 0);
    for (const [voice, depth] of [
      [loudVoice, 10],
      [quietVoice, 10],
      [quietVoice, 20],
    ] as const) {
      const out = await decode(await render(duckProject(voice, { duck: { depth } })), MUSIC_BAND);
      const base = rmsDb(out, 0.5, 2.9);
      expect(Math.abs(rmsDb(out, 3.3, 5.9) - base + depth), `depth ${depth}`).toBeLessThan(2);
      // Default release (400 ms): back within 1 dB after it.
      expect(Math.abs(rmsDb(out, 6.45, 7) - base)).toBeLessThan(1);
    }
  });

  it("holds through the release and goes down within the attack", async () => {
    const out = await decode(await render(duckProject(loudVoice, { duck: { release: 1200, attack: 50 } })), MUSIC_BAND);
    const base = rmsDb(out, 0.5, 2.9);
    expect(rmsDb(out, 2.9, 2.98) - base).toBeGreaterThan(-0.5);
    expect(rmsDb(out, 3.06, 3.1) - base).toBeLessThan(-8.5);
    expect(rmsDb(out, 6.5, 6.7) - base).toBeLessThan(-5);
    expect(Math.abs(rmsDb(out, 7.25, 7.6) - base)).toBeLessThan(1);
  });

  it("does not duck without a voice track, with duck: false, or under a muted voice", async () => {
    const flat = (x: Float32Array) => Math.abs(rmsDb(x, 3.3, 5.9) - rmsDb(x, 0.5, 2.9));
    const alone = await decode(await render({ version: 1, tracks: [musicTrack()], master: { loudness: null } }));
    expect(flat(alone)).toBeLessThan(0.1);
    expect(flat(await decode(await render(duckProject(loudVoice, { duck: false })), MUSIC_BAND))).toBeLessThan(0.1);
    const muted = await render(duckProject(loudVoice, {}, { mute: true }));
    expect(flat(await decode(muted))).toBeLessThan(0.1);
    expect(rmsDb(await decode(muted, VOICE_BAND), 3.3, 5.9)).toBeLessThan(-80);
  });

  it("solo: only soloed tracks are heard, voices hidden by a solo still duck, mute wins", async () => {
    const soloMusic = await render(duckProject(loudVoice, { solo: true }));
    expect(rmsDb(await decode(soloMusic, VOICE_BAND), 3.3, 5.9)).toBeLessThan(-80);
    const musicOnly = await decode(soloMusic, MUSIC_BAND);
    expect(rmsDb(musicOnly, 3.3, 5.9) - rmsDb(musicOnly, 0.5, 2.9)).toBeCloseTo(-10, 0);

    const soloVoice = await render(duckProject(loudVoice, {}, { solo: true }));
    expect(rmsDb(await decode(soloVoice, MUSIC_BAND), 0.5, 9.5)).toBeLessThan(-80);
    expect(rmsDb(await decode(soloVoice, VOICE_BAND), 3.3, 5.9)).toBeGreaterThan(-40);

    const mutedSolo = await render(duckProject(loudVoice, {}, { solo: true, mute: true }));
    expect(rmsDb(await decode(mutedSolo, VOICE_BAND), 3.3, 5.9)).toBeLessThan(-80);
  });
});

describe("tracks without clips", () => {
  it("a generator-only track (a hit at 2 s) adds its sound at that second", async () => {
    const out = await decode(
      await render({ version: 1, duration: 4, tracks: [{ id: "fx", role: "sfx", clips: [], steps: [{ effect: "hit", params: { at: 2 } }] }], master: { loudness: null } }),
    );
    expect(seconds(out)).toBeCloseTo(4, 3);
    expect(rmsDb(out, 0, 1.95)).toBeLessThan(-90);
    expect(rmsDb(out, 2, 2.5)).toBeGreaterThan(-30);
    expect(nonFinite(out)).toBe(0);
  });
});

describe("project duration", () => {
  const sources = { "a.wav": { duration: 3 }, "v.mp4": { duration: 7 } };
  const clip = (extra: object = {}): MixProject => ({ version: 1, tracks: [{ id: "a", role: "sfx", clips: [{ file: "a.wav", at: 2, ...extra }] }] });

  it("is `duration`, else the video's, else the end of the last clip with its tail", () => {
    expect(compileMix({ ...clip(), duration: 5.5, video: "v.mp4" }, sources).duration).toBe(5.5);
    expect(compileMix({ ...clip(), video: "v.mp4" }, sources).duration).toBe(7);
    expect(compileMix(clip(), sources).duration).toBe(5);
    expect(compileMix(clip({ start: 1 }), sources).duration).toBe(4);
    expect(compileMix(clip({ length: 0.5 }), sources).duration).toBe(2.5);
    expect(compileMix(clip({ steps: [{ effect: "reverb" }] }), sources).duration).toBe(8);
    // A muted clip still counts: muting does not change the timeline.
    expect(compileMix({ version: 1, tracks: [{ id: "a", role: "sfx", mute: true, clips: [{ file: "a.wav", at: 4 }] }] }, sources).duration).toBe(7);
  });

  it("needs a duration when nothing gives one, and rejects what it cannot compile", () => {
    const generator: MixProject = { version: 1, tracks: [{ id: "fx", role: "sfx", clips: [], steps: [{ effect: "hit" }] }] };
    expect(() => compileMix(generator, {})).toThrow(/set "duration"/);
    expect(() => compileMix(clip(), {})).toThrow(/Prepare the project first/);
    expect(() => compileMix(clip({ align: "onset" }), sources)).toThrow(/Prepare the project first/);
    expect(() => compileMix({ ...clip(), tracks: [{ id: "a", role: "sfx", clips: [{ file: "a.wav" }], steps: [{ effect: "slowmo" }] }] }, sources)).toThrow(
      /changes the audio duration/,
    );
    expect(() => compileMix({ ...clip(), master: { steps: [{ effect: "reverse" }] } }, sources)).toThrow(/changes the audio duration/);
    expect(compileMix(clip({ steps: [{ effect: "slowmo" }] }), sources).filterComplex).toContain("[out]");
    expect(() => compileMix(clip({ fadeIn: 2, fadeOut: 2 }), sources)).toThrow(/fades/);
    expect(() => compileMix({ ...clip(), tracks: [{ id: "v", role: "voice", duck: true, clips: [] }] }, sources)).toThrow(/cannot duck/);
    expect(() => compileMix({ version: 2 } as unknown as MixProject, sources)).toThrow(/version/);
  });
});

describe("master", () => {
  it("normalizes loudness to the target (default -14 LUFS) under the ceiling", async () => {
    for (const target of [undefined, -20]) {
      const out = await render({ ...duckProject(loudVoice), master: target === undefined ? {} : { loudness: target } });
      const analysis = await analyzeFile(out);
      expect(Math.abs(analysis.integratedLufs! - (target ?? -14))).toBeLessThan(1);
      expect(analysis.peakDb!).toBeLessThan(-0.9);
      expect(analysis.duration).toBeCloseTo(10, 1);
    }
  });
});

describe("master loudness on a wide dynamic range", () => {
  it("lands on the target when a quiet bed carries one loud stretch", async () => {
    // Measured gain, not single-pass loudnorm: that one drifts from the target and reshapes the dynamics.
    const out = await render({ version: 1, tracks: [musicTrack({ gain: -30 }), voiceTrack(loudVoice)], master: { loudness: -14 } });
    const analysis = await analyzeFile(out);
    expect(Math.abs(analysis.integratedLufs! + 14)).toBeLessThan(0.3);
    expect(analysis.peakDb!).toBeLessThan(-0.9);
  });
});

describe("master loudness against the ceiling", () => {
  it("pushes into the limiter when a loud hit keeps the plain gain short of the target", async () => {
    const project: MixProject = {
      version: 1,
      tracks: [musicTrack({ gain: -20 }), { id: "fx", role: "sfx", clips: [], steps: [{ effect: "hit", params: { at: 5 } }] }],
    };
    const analysis = await analyzeFile(await render(project));
    expect(Math.abs(analysis.integratedLufs! + 14)).toBeLessThan(1);
    expect(analysis.peakDb!).toBeLessThan(-0.9);
  });
});

describe("video", () => {
  it("copies the picture, replaces the audio with the mix and keeps the video's length", async () => {
    const project: MixProject = { version: 1, video, tracks: [{ id: "fx", role: "sfx", clips: [{ file: click, at: 1 }] }], master: { loudness: null } };
    const out = await render(project, {}, ".mp4");
    const info = await probeMedia(out);
    expect(info).toMatchObject({ hasVideo: true, videoCodec: "mpeg4", hasAudio: true, audioCodec: "aac", width: 160, height: 120 });
    expect(info.duration).toBeCloseTo(4, 1);
    const audio = await decode(out);
    expect(rmsDb(audio, 0.1, 0.9)).toBeLessThan(-60);
    expect(rmsDb(audio, 1.05, 1.35)).toBeGreaterThan(-25);

    const cut = await probeMedia(await render({ ...project, duration: 2.5 }, {}, ".mp4"));
    expect(cut.duration).toBeCloseTo(2.5, 1);
    await expect(render({ ...project, video: undefined }, {}, ".mp4")).rejects.toThrow(/give the project a "video"/);
  });
});

describe("preparing a project", () => {
  it("resolves library references, relative paths against the project folder, and rejects the rest", async () => {
    const resolveLibrary = (id: string) => (id === "abc" ? click : undefined);
    const project = (file: string, steps?: MixTrack["steps"]): MixProject => ({ version: 1, tracks: [{ id: "fx", role: "sfx", clips: [{ file }], steps }] });
    const ready = await prepareMix(project("library:abc"), { resolveLibrary });
    expect(ready.project.tracks[0].clips[0].file).toBe(click);
    expect(ready.media[click]).toMatchObject({ hasAudio: true, hasVideo: false });
    expect(ready.media[click].duration).toBeCloseTo(0.4, 2);

    const relative = await prepareMix(project("click.wav", [{ effect: "layer", params: { file: "late.wav", at: 0.1 } }]), { baseDir: tmp.dir });
    expect(relative.project.tracks[0].clips[0].file).toBe(click);
    expect(relative.project.tracks[0].steps![0].params!.file).toBe(late);

    await expect(prepareMix(project("library:nope"), { resolveLibrary })).rejects.toThrow(/not in the library/);
    await expect(prepareMix(project(click), { resolveLibrary, libraryOnly: true })).rejects.toThrow(/from the library/);
    await expect(prepareMix(project("missing.wav"), { baseDir: tmp.dir })).rejects.toThrow(/file not found/);
    await expect(prepareMix(project(silentVideo))).rejects.toThrow(/has no audio/);
    await expect(prepareMix({ version: 1, video: click, tracks: [] })).rejects.toThrow(/has no picture/);
  });
});

describe("media", () => {
  it("probes video, audio, files without audio and files whose container has no duration", async () => {
    expect(await probeMedia(video)).toEqual({
      duration: 4,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "mpeg4",
      audioCodec: "aac",
      width: 160,
      height: 120,
      fps: 25,
    });
    expect(await probeMedia(silentVideo)).toMatchObject({ duration: 3, hasVideo: true, hasAudio: false });
    expect(await probeMedia(noise)).toMatchObject({ hasVideo: false, hasAudio: true, audioCodec: "pcm_f32le" });
    // Matroska written to a pipe has no duration in its header: probing decodes it instead.
    const { stdout } = await runFfmpeg(["-v", "error", "-i", click, "-c:a", "flac", "-f", "matroska", "-"]);
    const piped = path.join(tmp.dir, "piped.mka");
    writeFileSync(piped, stdout);
    expect((await probeMedia(piped)).duration).toBeCloseTo(0.4, 1);
    await expect(probeMedia(path.join(tmp.dir, "missing.mp4"))).rejects.toThrow(/Could not read/);
  });

  it("detects a hard cut", async () => {
    const cuts = await detectCuts(video);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].time).toBeCloseTo(2, 1);
    expect(cuts[0].score).toBeGreaterThan(10);
    expect(await detectCuts(video, { threshold: 60 })).toEqual([]);
    await expect(detectCuts(noise)).rejects.toThrow(/no video/);
  });
});
