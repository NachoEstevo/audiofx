import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EffectStep, MixProject } from "../src/core/index.js";
import { makeSignal, rmsDb, tempDir } from "./helpers.js";

// Samples live under AUDIOFX_HOME: point it at a temp folder before the modules load.
const tmp = tempDir();
process.env.AUDIOFX_HOME = path.join(tmp.dir, "home");
process.env.AUDIOFX_LIBRARY = path.join(tmp.dir, "no-folders");
const { decodeFloat32, renderMix, runFfmpeg } = await import("../src/core/index.js");
const { scanLibrary } = await import("../src/library.js");
const { addSample, libraryResolver, listSamples } = await import("../src/samples.js");

afterAll(() => tmp.cleanup());

let drums: string;
let bass: string;
let instruments: string;
let full: string;

const band = (type: "highpass" | "lowpass", f: number) => Array(4).fill(`${type}=f=${f}`).join(",");
/** Each stem in its own band, so each can be measured inside the mix. */
const BANDS = {
  // Bass: a 55 Hz sine.
  bass: band("lowpass", 100),
  // Instruments: a 2 kHz sine.
  instruments: `${band("highpass", 1200)},${band("lowpass", 3300)}`,
  // Drums: hats (noise above 5 kHz) and a 400 Hz body on every beat (a 5 ms attack, so it does not spread into the bass).
  hats: band("highpass", 5000),
  body: `${band("highpass", 280)},${band("lowpass", 600)}`,
};

beforeAll(async () => {
  [drums, bass, instruments] = await Promise.all([
    makeSignal(
      tmp.dir,
      "drums",
      `anoisesrc=d=14:c=white:a=0.3:r=48000:seed=5,${band("highpass", 5000)}[h];` +
        "aevalsrc='0.15*sin(2*PI*400*t)*(1-exp(-200*mod(t,0.5)))*exp(-10*mod(t,0.5))':s=48000:d=14[k];[h][k]amix=inputs=2:normalize=0[out0]",
    ),
    makeSignal(tmp.dir, "bass", "sine=f=55:d=14:r=48000,volume=0.2"),
    makeSignal(tmp.dir, "instruments", "sine=f=2000:d=14:r=48000,volume=0.1"),
  ]);
  // The full song is the exact sum of its stems.
  full = path.join(tmp.dir, "full.wav");
  await runFfmpeg(["-y", "-v", "error", "-i", drums, "-i", bass, "-i", instruments, "-filter_complex", "amix=inputs=3:normalize=0", "-c:a", "pcm_f32le", full]);
});

let renders = 0;
async function render(project: MixProject): Promise<string> {
  const out = path.join(tmp.dir, `mix-${++renders}.wav`);
  await renderMix(project, out);
  return out;
}

/** The three stems as music tracks, their clips at the same `at` and `start`: the full song, placed at 1 s. */
const stemProject = (drumSteps?: EffectStep[]): MixProject => ({
  version: 1,
  tracks: [
    { id: "drums", role: "music", clips: [{ file: drums, at: 1, start: 0.5 }], steps: drumSteps },
    { id: "bass", role: "music", clips: [{ file: bass, at: 1, start: 0.5 }] },
    { id: "instruments", role: "music", clips: [{ file: instruments, at: 1, start: 0.5 }] },
  ],
  master: { loudness: null },
});

/** RMS (dB) of a - b over [from, to) seconds. */
function diffDb(a: Float32Array, b: Float32Array, from: number, to: number): number {
  const d = new Float32Array(Math.min(a.length, b.length));
  for (let i = 0; i < d.length; i++) d[i] = a[i] - b[i];
  return rmsDb(d, from, to);
}

describe("stems in a mix", () => {
  it("three stem tracks with clips at the same `at` add up to the full song", async () => {
    const stems = await decodeFloat32(await render(stemProject()));
    const song = await decodeFloat32(await render({ version: 1, tracks: [{ id: "song", role: "music", clips: [{ file: full, at: 1, start: 0.5 }] }], master: { loudness: null } }));
    expect(stems.length).toBe(song.length);
    expect(diffDb(stems, song, 0, 14.5)).toBeLessThan(rmsDb(song, 1, 14.5) - 80);
  });

  it("a windowed effect on the drums track treats only the drums, only inside the window", async () => {
    const window = { from: 5, to: 9, fade: 0.35 };
    const dryFile = await render(stemProject());
    const wetFile = await render(stemProject([{ effect: "underwater", ...window }]));
    const [dry, wet] = await Promise.all([decodeFloat32(dryFile), decodeFloat32(wetFile)]);

    // Outside the window (one 21 ms frame of margin after `to`, where the fade's last frame ends) the mix is
    // the same, sample for sample.
    expect(diffDb(wet, dry, 0, window.from)).toBeLessThan(-120);
    expect(diffDb(wet, dry, window.to + 0.05, 14.5)).toBeLessThan(-120);

    // Inside, the drums are underwater: the hats are gone and the body stays.
    const inside = [window.from + window.fade + 0.15, window.to - window.fade - 0.15] as const;
    const change = async (b: keyof typeof BANDS) => {
      const [w, d] = await Promise.all([decodeFloat32(wetFile, BANDS[b]), decodeFloat32(dryFile, BANDS[b])]);
      return rmsDb(w, ...inside) - rmsDb(d, ...inside);
    };
    const changes = Object.fromEntries(await Promise.all(Object.keys(BANDS).map(async (b) => [b, await change(b as keyof typeof BANDS)])));
    expect(changes.hats).toBeLessThan(-30);
    expect(Math.abs(changes.body)).toBeLessThan(6);
    // The other stems are untouched.
    expect(Math.abs(changes.bass)).toBeLessThan(0.05);
    expect(Math.abs(changes.instruments)).toBeLessThan(0.05);
  });
});

describe("stems as samples", () => {
  it("keeps each stem of a recording once, names it by its stem and lists it as music", async () => {
    const id = "6f1c2a9e-stem-test";
    const added: Awaited<ReturnType<typeof addSample>>[] = [];
    for (const [file, stem] of [
      [full, "full"],
      [drums, "drums"],
      [bass, "bass"],
      [instruments, "instruments"],
    ] as const) {
      added.push(await addSample({ from: file, title: "Neon Run", id, stem, source: "epidemic-sound" }));
    }
    expect(new Set(added.map((s) => s.file)).size).toBe(4);
    expect(path.basename(added[1].file)).toMatch(/^neon-run-6f1c2a9e-drums\.wav$/);
    expect(JSON.parse(readFileSync(added[1].file.replace(/\.wav$/, ".json"), "utf8"))).toMatchObject({ id, title: "Neon Run", stem: "drums", kind: "music" });

    const listed = listSamples();
    expect(listed.map((s) => s.name).sort()).toEqual(["Neon Run · bass", "Neon Run · drums", "Neon Run · full", "Neon Run · instruments"]);
    expect(listed.every((s) => s.kind === "music" && s.title === "Neon Run")).toBe(true);
    const lib = scanLibrary();
    expect(lib.items.find((i) => lib.paths.get(i.id) === added[1].file)).toMatchObject({ name: "Neon Run · drums", folder: "Epidemic Sound", kind: "music", sample: true });
    expect(libraryResolver()(added[2].ref.slice("library:".length))).toBe(added[2].file);
  });

  it("adding the same id and stem again replaces it, even under a new title", async () => {
    const id = "aa11bb22-replace";
    const first = await addSample({ from: drums, title: "Old title", id, stem: "drums" });
    const other = await addSample({ from: bass, title: "Old title", id, stem: "bass" });
    const again = await addSample({ from: drums, title: "New title", id, stem: "drums" });
    expect(existsSync(first.file)).toBe(false);
    expect(existsSync(first.file.replace(/\.wav$/, ".json"))).toBe(false);
    expect(existsSync(again.file)).toBe(true);
    expect(existsSync(other.file)).toBe(true);
    const mine = listSamples().filter((s) => s.id === id);
    expect(mine.map((s) => s.name).sort()).toEqual(["New title · drums", "Old title · bass"]);
    // Without a stem, the same id is a different sample.
    await addSample({ from: drums, title: "New title", id });
    expect(listSamples().filter((s) => s.id === id)).toHaveLength(3);
  });
});
