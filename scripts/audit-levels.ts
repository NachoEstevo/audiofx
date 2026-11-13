/**
 * Level audit: renders every effect with its defaults over the demo voice and music, and reports how much
 * it changes the integrated loudness and whether it reaches the true-peak ceiling. A sound engineer's
 * first check: an effect should change the character, not surprise you with a level jump or clipping.
 *
 *   pnpm tsx scripts/audit-levels.ts [voice.wav] [music.wav]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EFFECTS, analyzeFile, applyToFile } from "../src/core/index.js";

const dir = mkdtempSync(path.join(tmpdir(), "audiofx-audit-"));
const cache = path.join(tmpdir(), "audiofx-demo-cache");
const sources = {
  voice: process.argv[2] ?? path.join(cache, "voice-v4.wav"),
  music: process.argv[3] ?? path.join(cache, "music-v4.wav"),
};

const rows: string[] = [];
try {
  const base = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([k, f]) => [k, await analyzeFile(f)])));
  for (const e of EFFECTS) {
    const cells: string[] = [];
    for (const [kind, file] of Object.entries(sources)) {
      const out = path.join(dir, `${e.id}-${kind}.wav`);
      const step = e.timed ? { effect: e.id, params: { at: 4 } } : { effect: e.id };
      try {
        await applyToFile(file, out, [step]);
        const a = await analyzeFile(out);
        const delta = (a.integratedLufs ?? -70) - (base[kind].integratedLufs ?? -70);
        const flag = (a.truePeakDb ?? -99) > -0.5 ? " CLIP" : Math.abs(delta) > 6 ? " JUMP" : "";
        cells.push(`${kind} ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} LU, TP ${a.truePeakDb?.toFixed(1)}${flag}`);
      } catch (error) {
        cells.push(`${kind} ERROR ${(error as Error).message.slice(0, 60)}`);
      }
    }
    rows.push(`${e.id.padEnd(16)} ${cells.join("  |  ")}`);
  }
  console.log(`voice ${base.voice.integratedLufs} LUFS TP ${base.voice.truePeakDb} · music ${base.music.integratedLufs} LUFS TP ${base.music.truePeakDb}`);
  console.log(rows.join("\n"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
