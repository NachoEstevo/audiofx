import { describe, expect, it } from "vitest";
import { compile, getEffect, parseStep, resolveParams } from "../src/core/index.js";

describe("params", () => {
  it("fills in defaults and converts CLI strings", () => {
    const p = resolveParams(getEffect("pitch"), { semitones: "3", formant: "true" });
    expect(p).toMatchObject({ semitones: 3, formant: true });
    expect(resolveParams(getEffect("am-radio"), { drive: "10" })).toMatchObject({ drive: 10, noise: 0.4 });
  });

  it("rejects unknown, out-of-range or invalid enum params", () => {
    expect(() => resolveParams(getEffect("lowpass"), { cutoff: 100 })).toThrow(/has no param "cutoff"/);
    expect(() => resolveParams(getEffect("lowpass"), { freq: 5 })).toThrow(/out of range/);
    expect(() => resolveParams(getEffect("reverb"), { space: "moon" })).toThrow(/one of/);
  });

  it("suggests similar ids when the effect does not exist", () => {
    expect(() => getEffect("radio")).toThrow(/am-radio/);
  });
});

describe("CLI short form", () => {
  it("parses effect, params and window", () => {
    expect(parseStep("underwater:depth=0.8,wobble=0.2@3.5-7")).toEqual({
      effect: "underwater",
      params: { depth: "0.8", wobble: "0.2" },
      from: 3.5,
      to: 7,
    });
    expect(parseStep("reverb@2-")).toEqual({ effect: "reverb", params: {}, from: 2 });
  });
});

describe("filtergraph", () => {
  it("builds a graph usable with -af, with unique output labels", () => {
    const { graph } = compile([{ effect: "reverb" }, { effect: "vinyl" }, { effect: "underwater", from: 1, to: 2 }]);
    expect(graph.startsWith("aresample=48000")).toBe(true);
    expect(graph.endsWith("anull")).toBe(true);
    const produced = [...graph.matchAll(/\[([a-z]+\d+)\](?=;|$)/g)].map((m) => m[1]);
    expect(new Set(produced).size).toBe(produced.length);
  });

  it("adds a tail only when an effect has one", () => {
    expect(compile([{ effect: "lowpass" }]).tail).toBe(0);
    expect(compile([{ effect: "echo" }]).tail).toBe(3);
    expect(compile([{ effect: "echo" }], { tail: 0 }).graph).not.toContain("apad");
  });
});
