import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers.js";

// Generations are written under AUDIOFX_HOME: point it at a temp folder before the modules load.
const tmp = tempDir();
process.env.AUDIOFX_HOME = tmp.dir;
const { generate, findApiKey } = await import("../src/elevenlabs.js");
const { scanLibrary } = await import("../src/library.js");

const savedKey = process.env.ELEVENLABS_API_KEY;
const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];

beforeAll(() => {
  process.env.ELEVENLABS_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("xi-api-key") });
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  });
});
afterEach(() => {
  calls.length = 0;
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = savedKey;
  tmp.cleanup();
});

describe("ElevenLabs generation", () => {
  it("calls sound-generation with the v3 model, clamped duration and loop", async () => {
    const gen = await generate({ kind: "sfx", prompt: "Cinematic braam, dark", duration: 45, loop: true, influence: 0.6 });
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
    expect(calls[0].key).toBe("test-key");
    expect(calls[0].body).toEqual({ text: "Cinematic braam, dark", model_id: "eleven_text_to_sound_v3", duration_seconds: 30, prompt_influence: 0.6, loop: true });
    expect(path.basename(gen.file)).toMatch(/^sfx-cinematic-braam-dark-\d{8}-\d{6}\.mp3$/);
    expect(existsSync(gen.file)).toBe(true);
    expect(JSON.parse(readFileSync(gen.file.replace(/\.mp3$/, ".json"), "utf8")).prompt).toBe("Cinematic braam, dark");
  });

  it("speaks with a premade default voice and composes instrumental music in milliseconds", async () => {
    await generate({ kind: "voice", prompt: "In a world where..." });
    expect(calls[0].url).toContain("/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?");
    expect(calls[0].body).toEqual({ text: "In a world where...", model_id: "eleven_v4" });
    await generate({ kind: "music", prompt: "Tense trailer drums", duration: 20, instrumental: true });
    expect(calls[1].url).toContain("/v1/music?");
    expect(calls[1].body).toEqual({ prompt: "Tense trailer drums", music_length_ms: 20000, force_instrumental: true });
  });

  it("puts generations first in the library, classified by their prefix", () => {
    const { items } = scanLibrary();
    const generated = items.filter((i) => i.generated);
    expect(generated.map((i) => i.kind).sort()).toEqual(["music", "sfx", "voice"]);
    expect(items[0].generated).toBe(true);
    expect(generated.every((i) => i.folder === "ElevenLabs")).toBe(true);
    // Named after the prompt in the sidecar, not the slugged file name.
    expect(generated.map((i) => i.name)).toContain("Cinematic braam, dark");
  });

  it("explains how to connect when there is no key, without calling the API", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const cwd = process.cwd();
    process.chdir(tmp.dir);
    try {
      if (findApiKey()) return; // A real key in this repo's .env or ~/.audiofx would make this case untestable.
      await expect(generate({ kind: "sfx", prompt: "door slam" })).rejects.toThrow(/onboard init/);
      expect(calls).toHaveLength(0);
    } finally {
      process.chdir(cwd);
      process.env.ELEVENLABS_API_KEY = "test-key";
    }
  });

  it("surfaces API errors with a hint", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: { status: "paid_plan_required" } }), { status: 402 }));
    await expect(generate({ kind: "voice", prompt: "hi", voice: "library-voice" })).rejects.toThrow(/402: paid_plan_required.*premade/);
  });
});
