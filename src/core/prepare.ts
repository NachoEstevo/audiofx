import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { LIBRARY_REF } from "./effects/layer.js";
import { measureSync, type SyncPoints } from "./ffmpeg.js";
import { getEffect } from "./registry.js";
import type { EffectStep, Params } from "./types.js";

export interface PrepareOptions {
  /** Turns the id of a `library:<id>` reference into a file path (undefined when it is not in the library). */
  resolveLibrary?: (id: string) => string | undefined;
  /** Only library references are accepted, never paths. The studio server sets it: the browser sends ids. */
  libraryOnly?: boolean;
}

const measured = new Map<string, SyncPoints>();

async function syncOf(file: string): Promise<SyncPoints> {
  const key = `${file}|${statSync(file).mtimeMs}`;
  let points = measured.get(key);
  if (!points) {
    points = await measureSync(file);
    measured.set(key, points);
  }
  return points;
}

/**
 * What a chain needs from the disk before it can be compiled (compiling itself stays pure, so it also runs
 * in the browser): file params become absolute paths that exist, and a layer with align=onset or
 * align=peak gets its sync point measured from the sample.
 */
export async function prepareSteps(steps: EffectStep[], options: PrepareOptions = {}): Promise<EffectStep[]> {
  const out: EffectStep[] = [];
  for (const step of steps) {
    const effect = getEffect(step.effect);
    const fileParams = effect.params.filter((p) => p.type === "file");
    if (!fileParams.length) {
      out.push(step);
      continue;
    }
    const params: Params = { ...step.params };
    for (const spec of fileParams) {
      const raw = String(params[spec.id] ?? "").trim();
      if (!raw) throw new Error(`${effect.id}: give the sample to mix in (${spec.id}=<path> or ${spec.id}=${LIBRARY_REF}<id>).`);
      if (raw.startsWith(LIBRARY_REF)) {
        const file = options.resolveLibrary?.(raw.slice(LIBRARY_REF.length));
        if (!file) throw new Error(`${effect.id}: "${raw}" is not in the library. Run \`sfx sample list\` (or refresh the studio).`);
        params[spec.id] = file;
      } else if (options.libraryOnly) {
        throw new Error(`${effect.id}: pick a sample from the library.`);
      } else {
        const file = path.resolve(raw);
        if (!existsSync(file)) throw new Error(`${effect.id}: file not found: ${raw}`);
        params[spec.id] = file;
      }
    }
    if (effect.id === "layer" && (params.align === "onset" || params.align === "peak")) {
      const points = await syncOf(String(params.file));
      params.sync = params.align === "onset" ? points.onset : points.peak;
    }
    out.push({ ...step, params });
  }
  return out;
}
