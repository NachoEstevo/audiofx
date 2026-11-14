import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeSignal, render, rmsDb, seconds, tempDir } from "./helpers.js";

// Samples live under AUDIOFX_HOME: point it at a temp folder before the modules load.
const tmp = tempDir();
process.env.AUDIOFX_HOME = path.join(tmp.dir, "home");
process.env.AUDIOFX_LIBRARY = path.join(tmp.dir, "no-folders");
const { compile, measureSync, parseStep, prepareSteps, syncPoints } = await import("../src/core/index.js");
const { scanLibrary } = await import("../src/library.js");
const { addSample, libraryResolver, listSamples } = await import("../src/samples.js");

let tone: string;
let click: string;
let late: string;

beforeAll(async () => {
  tone = await makeSignal(tmp.dir, "tone4", "sine=f=330:d=4:r=48000,volume=0.05");
  // A sample that starts right away, and one with 0.3 s of silence before its attack.
  click = await makeSignal(tmp.dir, "click", "anoisesrc=d=0.4:c=pink:a=0.6:r=48000:seed=3");
  late = await makeSignal(tmp.dir, "late", "anoisesrc=d=0.4:c=pink:a=0.6:r=48000:seed=3,adelay=delays=300:all=1");
});
afterAll(() => tmp.cleanup());

/** Second where the layered sample starts: the tone is quiet, so the first loud 5 ms block is the sample. */
const landing = (x: Float32Array) => syncPoints(x).onset;

describe("library excludes", () => {
  it("hides the files whose path contains a text from library.json's exclude", () => {
    const folder = path.join(tmp.dir, "no-folders");
    mkdirSync(folder, { recursive: true });
    mkdirSync(path.join(tmp.dir, "home"), { recursive: true });
    copyFileSync(tone, path.join(folder, "keep me.wav"));
    copyFileSync(tone, path.join(folder, "Client demo song.wav"));
    const config = path.join(tmp.dir, "home", "library.json");
    writeFileSync(config, JSON.stringify({ exclude: ["client DEMO"] }));
    expect(scanLibrary().items.map((i) => i.name)).toEqual(["keep me"]);
    writeFileSync(config, JSON.stringify({}));
    expect(scanLibrary().items.map((i) => i.name).sort()).toEqual(["Client demo song", "keep me"]);
  });
});

describe("layer", () => {
  it("lands the sample on `at`, leaves the rest untouched and keeps the duration", async () => {
    const dry = await render(tone, [{ effect: "gain", params: { db: 0 } }]);
    const out = await render(tone, [{ effect: "layer", params: { file: click, at: 2 } }], { tail: 0 });
    expect(landing(out)).toBeCloseTo(2, 2);
    expect(Math.abs(rmsDb(out, 0.2, 1.95) - rmsDb(dry, 0.2, 1.95))).toBeLessThan(0.2);
    expect(Math.abs(rmsDb(out, 2.6, 3.9) - rmsDb(dry, 2.6, 3.9))).toBeLessThan(0.2);
    expect(seconds(out)).toBeCloseTo(4, 2);
  });

  it("`sync` puts a point inside the sample on the moment", async () => {
    const naive = await render(tone, [{ effect: "layer", params: { file: late, at: 2 } }], { tail: 0 });
    expect(landing(naive)).toBeCloseTo(2.3, 2);
    const synced = await render(tone, [{ effect: "layer", params: { file: late, at: 2, sync: 0.3 } }], { tail: 0 });
    expect(landing(synced)).toBeCloseTo(2, 2);
  });

  it("trims the head of the sample when the sync point would start it before 0", async () => {
    const out = await render(tone, [{ effect: "layer", params: { file: late, at: 0.1, sync: 0.3 } }], { tail: 0 });
    expect(landing(out)).toBeCloseTo(0.1, 2);
  });

  it("`level` sets the sample's gain, `length` cuts it and the fades shape it", async () => {
    const loud = await render(tone, [{ effect: "layer", params: { file: click, at: 1 } }], { tail: 0 });
    const soft = await render(tone, [{ effect: "layer", params: { file: click, at: 1, level: -12 } }], { tail: 0 });
    expect(rmsDb(loud, 1.05, 1.35) - rmsDb(soft, 1.05, 1.35)).toBeGreaterThan(10);
    const cut = await render(tone, [{ effect: "layer", params: { file: click, at: 1, length: 0.15 } }], { tail: 0 });
    expect(rmsDb(loud, 1.2, 1.38) - rmsDb(cut, 1.2, 1.38)).toBeGreaterThan(10);
    const faded = await render(tone, [{ effect: "layer", params: { file: click, at: 1, fadeIn: 0.2, fadeOut: 0.2 } }], { tail: 0 });
    expect(rmsDb(loud, 1, 1.03) - rmsDb(faded, 1, 1.03)).toBeGreaterThan(10);
    expect(rmsDb(loud, 1.37, 1.4) - rmsDb(faded, 1.37, 1.4)).toBeGreaterThan(10);
    expect(Math.abs(rmsDb(loud, 1.19, 1.21) - rmsDb(faded, 1.19, 1.21))).toBeLessThan(1.5);
  });

  it("reads files whose names have spaces, quotes, commas, brackets and equals signs", async () => {
    const dir = path.join(tmp.dir, "odd [dir], it's =here");
    mkdirSync(dir, { recursive: true });
    const odd = await makeSignal(dir, "glass; break = 100% (take 2)", "anoisesrc=d=0.3:c=white:a=0.5:r=48000:seed=5");
    const out = await render(tone, [{ effect: "layer", params: { file: odd, at: 1.5 } }], { tail: 0 });
    expect(landing(out)).toBeCloseTo(1.5, 2);
  });

  it("needs a file", () => {
    expect(() => compile([{ effect: "layer" }])).toThrow(/give the sample/);
  });
});

describe("sync points", () => {
  it("finds the attack and the loudest point of a sample", async () => {
    expect((await measureSync(click)).onset).toBeLessThan(0.011);
    expect((await measureSync(late)).onset).toBeCloseTo(0.3, 2);
    const swell = await makeSignal(tmp.dir, "swell", "anoisesrc=d=1:c=pink:a=0.5:r=48000:seed=9,afade=t=in:d=0.6,afade=t=out:st=0.6:d=0.4");
    expect((await measureSync(swell)).peak).toBeGreaterThan(0.45);
    expect((await measureSync(swell)).peak).toBeLessThan(0.75);
  });

  it("align=onset lands the attack on the moment without giving `sync`", async () => {
    const steps = await prepareSteps([{ effect: "layer", params: { file: late, at: 2, align: "onset" } }]);
    expect(steps[0].params!.sync).toBeCloseTo(0.3, 2);
    expect(landing(await render(tone, steps, { tail: 0 }))).toBeCloseTo(2, 2);
  });
});

describe("preparing a chain", () => {
  it("resolves library references and rejects unknown ones, missing files and paths when only the library is allowed", async () => {
    const resolveLibrary = (id: string) => (id === "abc" ? click : undefined);
    const [step] = await prepareSteps([{ effect: "layer", params: { file: "library:abc" } }], { resolveLibrary });
    expect(step.params!.file).toBe(click);
    await expect(prepareSteps([{ effect: "layer", params: { file: "library:nope" } }], { resolveLibrary })).rejects.toThrow(/not in the library/);
    await expect(prepareSteps([{ effect: "layer", params: { file: path.join(tmp.dir, "missing.wav") } }])).rejects.toThrow(/file not found/);
    await expect(prepareSteps([{ effect: "layer", params: { file: click } }], { resolveLibrary, libraryOnly: true })).rejects.toThrow(/from the library/);
    await expect(prepareSteps([{ effect: "layer" }])).rejects.toThrow(/give the sample/);
  });

  it("leaves steps without files as they are", async () => {
    const steps = [{ effect: "reverb" }, { effect: "hit", params: { at: 2 } }];
    expect(await prepareSteps(steps)).toEqual(steps);
  });
});

describe("CLI short form with file paths", () => {
  it("keeps drive letters, commas, @ and dashes inside a path", () => {
    expect(parseStep("layer:file=C:\\Users\\me\\sfx\\door, heavy @2-take.wav,at=6,align=onset")).toEqual({
      effect: "layer",
      params: { file: "C:\\Users\\me\\sfx\\door, heavy @2-take.wav", at: "6", align: "onset" },
    });
    expect(parseStep("layer:file=library:ab12cd34ef56,at=1.5")).toEqual({ effect: "layer", params: { file: "library:ab12cd34ef56", at: "1.5" } });
    expect(parseStep("underwater:depth=0.8@-7")).toEqual({ effect: "underwater", params: { depth: "0.8" }, to: 7 });
    expect(() => parseStep("lowpass:800")).toThrow(/Malformed param/);
  });
});

describe("samples folder", () => {
  it("adds a sample with its .json, lists it in the library and resolves its reference", async () => {
    const sample = await addSample({ from: late, title: "Door slam, heavy", id: "1234abcd-0000", source: "epidemic-sound" });
    expect(path.dirname(sample.file)).toBe(path.join(tmp.dir, "home", "samples"));
    expect(sample.onset).toBeCloseTo(0.3, 2);
    expect(sample.duration).toBeCloseTo(0.7, 1);
    expect(sample.ref).toMatch(/^library:[0-9a-f]{12}$/);

    const lib = scanLibrary();
    const item = lib.items.find((i) => lib.paths.get(i.id) === sample.file)!;
    expect(item).toMatchObject({ name: "Door slam, heavy", folder: "Epidemic Sound", kind: "sfx", sample: true, generated: false });
    expect(libraryResolver()(sample.ref.slice("library:".length))).toBe(sample.file);
    expect(listSamples().map((s) => s.title)).toEqual(["Door slam, heavy"]);

    // Adding the same library id again replaces the file instead of piling up copies.
    await addSample({ from: late, title: "Door slam, heavy", id: "1234abcd-0000", source: "epidemic-sound" });
    expect(listSamples()).toHaveLength(1);
  });

  it("downloads a sample from a signed link without keeping the link", async () => {
    const link = "https://cdn.example.test/audio/whoosh.wav?signature=secret-token";
    vi.stubGlobal("fetch", async (url: URL) => {
      expect(String(url)).toBe(link);
      return new Response(readFileSync(click), { status: 200, headers: { "content-type": "audio/wav" } });
    });
    try {
      const sample = await addSample({ from: link, title: "Whoosh fast", id: "feedbeef", source: "epidemic-sound" });
      expect(path.extname(sample.file)).toBe(".wav");
      expect(sample.duration).toBeCloseTo(0.4, 1);
      expect(readFileSync(sample.file.replace(/\.wav$/, ".json"), "utf8")).not.toMatch(/secret-token|example\.test/);
      vi.stubGlobal("fetch", async () => new Response("expired", { status: 403 }));
      await expect(addSample({ from: link, title: "Expired" })).rejects.toThrow(/Download failed \(403\)/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists tiny files and falls back to the file name without a .json", () => {
    const dir = path.join(tmp.dir, "home", "samples");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tick.wav"), Buffer.alloc(64));
    expect(scanLibrary().items.find((i) => i.name === "tick")).toMatchObject({ folder: "Samples", kind: "sfx", sample: true });
  });

  it("rejects files that are not audio and leaves nothing behind", async () => {
    const fake = path.join(tmp.dir, "fake.wav");
    writeFileSync(fake, "not audio");
    await expect(addSample({ from: fake, title: "Fake" })).rejects.toThrow(/Could not read/);
    expect(listSamples().some((s) => s.title === "Fake")).toBe(false);
  });
});
