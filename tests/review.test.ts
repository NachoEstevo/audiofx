import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

// The review lives under AUDIOFX_HOME: point it at a temp folder before the module loads.
const tmp = tempDir();
const home = path.join(tmp.dir, "home");
process.env.AUDIOFX_HOME = home;
const { clearVerdict, MAX_NOTE_LENGTH, readReview, REVIEW_FILE, ReviewError, setVerdict } = await import("../src/review.js");

const onDisk = () => JSON.parse(readFileSync(REVIEW_FILE, "utf8"));

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});
afterAll(() => tmp.cleanup());

describe("review file", () => {
  it("lives in AUDIOFX_HOME and reads as an empty review while there is none", () => {
    expect(REVIEW_FILE).toBe(path.join(home, "review.json"));
    expect(readReview()).toEqual({ review: { version: 1, updated: null, effects: {} }, problem: null });
  });

  it("saves a verdict with its note, params and source, and reads it back", () => {
    const saved = setVerdict("lowpass", { verdict: "tweak", note: "  too dark at the default  ", params: { freq: "1200" }, source: "voice take 3.wav" });
    expect(saved.entry).toMatchObject({ verdict: "tweak", note: "too dark at the default", params: { freq: 1200 }, source: "voice take 3.wav" });
    expect(Date.parse(saved.entry!.reviewed)).not.toBeNaN();
    expect(saved.keptAside).toBeNull();

    const file = onDisk();
    expect(file).toEqual({ version: 1, updated: saved.updated, effects: { lowpass: saved.entry } });
    expect(readReview().review).toEqual(file);
  });

  it("replaces an entry as a whole and keeps the others", () => {
    setVerdict("reverb", { verdict: "keep", note: "fine" });
    setVerdict("telephone", { verdict: "cut" });
    setVerdict("reverb", { verdict: "cut" });
    const { effects } = readReview().review;
    expect(Object.keys(effects).sort()).toEqual(["reverb", "telephone"]);
    expect(effects.reverb).toEqual({ verdict: "cut", reviewed: expect.any(String) });
  });

  it("clears a verdict, and clearing one that is not there is a no-op", () => {
    setVerdict("echo", { verdict: "keep" });
    expect(clearVerdict("echo").entry).toBeNull();
    expect(onDisk().effects).toEqual({});
    expect(clearVerdict("echo")).toMatchObject({ effect: "echo", entry: null });
  });

  it("leaves no temp files behind", () => {
    setVerdict("echo", { verdict: "keep" });
    setVerdict("gain", { verdict: "tweak", params: { db: 3 } });
    expect(readdirSync(home)).toEqual(["review.json"]);
  });
});

describe("validation", () => {
  const rejects = (fn: () => unknown, message: RegExp, status = 400) => {
    let error: unknown;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReviewError);
    expect((error as Error).message).toMatch(message);
    expect((error as InstanceType<typeof ReviewError>).status).toBe(status);
  };

  it("rejects unknown effects, verdicts outside the enum, long notes and params the effect does not accept", () => {
    rejects(() => setVerdict("no-such-effect", { verdict: "keep" }), /Unknown effect/, 404);
    rejects(() => setVerdict("reverb", { verdict: "maybe" }), /verdict must be one of: keep, tweak, cut/);
    rejects(() => setVerdict("reverb", "keep"), /JSON object/);
    rejects(() => setVerdict("reverb", { verdict: "keep", note: "x".repeat(MAX_NOTE_LENGTH + 1) }), /too long/);
    rejects(() => setVerdict("reverb", { verdict: "keep", note: 42 }), /note must be text/);
    rejects(() => setVerdict("lowpass", { verdict: "tweak", params: { freq: 5 } }), /out of range/);
    rejects(() => setVerdict("lowpass", { verdict: "tweak", params: { color: "red" } }), /has no param "color"/);
    rejects(() => setVerdict("reverb", { verdict: "tweak", params: { space: "garage" } }), /must be one of/);
    rejects(() => setVerdict("reverb", { verdict: "tweak", params: { mix: { nested: 1 } } }), /params must be an object/);
    rejects(() => clearVerdict("no-such-effect"), /Unknown effect/, 404);
    expect(existsSync(REVIEW_FILE)).toBe(false);
  });

  it("accepts a note at the limit and drops empty notes and params", () => {
    const at = setVerdict("reverb", { verdict: "keep", note: "x".repeat(MAX_NOTE_LENGTH) });
    expect(at.entry!.note).toHaveLength(MAX_NOTE_LENGTH);
    expect(setVerdict("reverb", { verdict: "keep", note: "   ", params: {} }).entry).toEqual({ verdict: "keep", reviewed: expect.any(String) });
  });
});

describe("reading tolerantly", () => {
  it("treats a corrupt file as an empty review and keeps it aside on the next write", () => {
    writeFileSync(REVIEW_FILE, "{ not json");
    const read = readReview();
    expect(read.review.effects).toEqual({});
    expect(read.problem).toMatch(/could not be read/);

    const saved = setVerdict("echo", { verdict: "keep" });
    expect(saved.keptAside).toMatch(/^review\.corrupt-.+\.json$/);
    expect(readFileSync(path.join(home, saved.keptAside!), "utf8")).toBe("{ not json");
    expect(onDisk().effects).toEqual({ echo: saved.entry });
    expect(readReview().problem).toBeNull();
  });

  it("treats another version or shape as unreadable instead of overwriting it", () => {
    writeFileSync(REVIEW_FILE, JSON.stringify({ version: 2, effects: { echo: { verdict: "keep" } } }));
    expect(readReview().problem).toMatch(/not a version 1 review/);
    const saved = setVerdict("echo", { verdict: "cut" });
    expect(JSON.parse(readFileSync(path.join(home, saved.keptAside!), "utf8")).version).toBe(2);
  });

  it("keeps readable entries, reports the rest and keeps effects that left the catalog", () => {
    writeFileSync(
      REVIEW_FILE,
      JSON.stringify({
        version: 1,
        updated: "2026-11-01T10:00:00.000Z",
        effects: {
          reverb: { verdict: "keep", reviewed: "2026-11-01T10:00:00.000Z" },
          "retired-effect": { verdict: "cut", note: "gone", reviewed: "2026-11-01T10:00:00.000Z" },
          echo: { verdict: "perhaps", reviewed: "2026-11-01T10:00:00.000Z" },
          gain: "keep",
        },
      }),
    );
    const read = readReview();
    expect(Object.keys(read.review.effects).sort()).toEqual(["retired-effect", "reverb"]);
    expect(read.problem).toMatch(/2 entries/);

    // The next write keeps the original aside (nothing is lost) and preserves the retired effect.
    const saved = setVerdict("telephone", { verdict: "tweak", params: { noise: 0 } });
    expect(saved.keptAside).not.toBeNull();
    expect(Object.keys(onDisk().effects).sort()).toEqual(["retired-effect", "reverb", "telephone"]);
    expect(clearVerdict("retired-effect").entry).toBeNull();
    expect(Object.keys(onDisk().effects).sort()).toEqual(["reverb", "telephone"]);
  });
});
