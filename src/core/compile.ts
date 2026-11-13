import { n } from "./graph.js";
import { getEffect, resolveParams } from "./registry.js";
import { SAMPLE_RATE, type BuildContext, type CompileOptions, type EffectStep } from "./types.js";

export interface CompiledGraph {
  /** Filtergraph for `ffmpeg -af "<graph>"` (one input, one output, no external labels). */
  graph: string;
  /** Steps with full params, useful for saving reproducible presets. */
  steps: Required<Pick<EffectStep, "effect" | "params">>[];
  /** Seconds of silence added at the end for tails. */
  tail: number;
  changesDuration: boolean;
}

const DEFAULT_TAIL = 3;

/** 0–1 envelope for the [from, to] window with `fade`-second ramps. Evaluated per frame in `volume`. */
function windowEnvelope(from: number | undefined, to: number | undefined, fade: number, mix: number): string {
  const f = Math.max(0.001, fade);
  const parts: string[] = [];
  if (from !== undefined) parts.push(`clip((t-${n(from)})/${n(f)},0,1)`);
  if (to !== undefined) parts.push(`clip((${n(to)}-t)/${n(f)},0,1)`);
  const body = parts.length ? parts.join("*") : "1";
  return mix === 1 ? body : `${n(mix)}*${body}`;
}

/** Compiles an effect chain into a single ffmpeg filtergraph. */
export function compile(steps: EffectStep[], options: CompileOptions = {}): CompiledGraph {
  if (!steps.length) throw new Error("The chain is empty: give at least one effect.");
  let counter = 0;
  const label = (hint: string) => `${hint}${++counter}`;
  const parts: string[] = [];
  const resolved: CompiledGraph["steps"] = [];
  const seed = options.seed ?? 1234;

  const effects = steps.map((s) => getEffect(s.effect));
  const anyTail = effects.some((e) => e.hasTail);
  const tail = options.tail ?? (anyTail ? DEFAULT_TAIL : 0);

  let current = label("s");
  const head = options.normalize === false ? ["anull"] : [`aresample=${SAMPLE_RATE}`, "aformat=sample_fmts=fltp:channel_layouts=stereo"];
  if (tail > 0) head.push(`apad=pad_dur=${n(tail)}`);
  parts.push(`${head.join(",")}[${current}]`);

  steps.forEach((step, index) => {
    const effect = effects[index];
    const params = resolveParams(effect, step.params);
    resolved.push({ effect: effect.id, params });
    const mix = step.mix ?? 1;
    if (mix < 0 || mix > 1) throw new Error(`${effect.id}: mix must be between 0 and 1.`);
    const windowed = step.from !== undefined || step.to !== undefined || mix < 1;
    if (windowed && effect.changesDuration) {
      throw new Error(`${effect.id} changes the audio duration and does not support from/to/mix. Apply it to an already trimmed clip.`);
    }
    if (step.from !== undefined && step.to !== undefined && step.to <= step.from) {
      throw new Error(`${effect.id}: "to" (${step.to}) must be greater than "from" (${step.from}).`);
    }

    const output = label("s");
    const ctx = (input: string, out: string): BuildContext => ({ input, output: out, label, seed: seed + index * 17 });

    if (!windowed) {
      parts.push(effect.build(params, ctx(current, output)));
    } else {
      const dry = label("dry");
      const wetIn = label("wet");
      const wetOut = label("fx");
      const wetGain = label("wg");
      const dryGain = label("dg");
      const env = windowEnvelope(step.from, step.to, step.fade ?? 0.25, mix);
      parts.push(`[${current}]asplit=2[${dry}][${wetIn}]`);
      parts.push(effect.build(params, ctx(wetIn, wetOut)));
      parts.push(`[${wetOut}]volume='${env}':eval=frame[${wetGain}]`);
      parts.push(`[${dry}]volume='1-(${env})':eval=frame[${dryGain}]`);
      parts.push(`[${dryGain}][${wetGain}]amix=inputs=2:duration=first:normalize=0[${output}]`);
    }
    current = output;
  });

  parts.push(`[${current}]anull`);
  return { graph: parts.join(";"), steps: resolved, tail, changesDuration: effects.some((e) => e.changesDuration) };
}

/** Parses "effect:param=value,param=value@from-to" (the CLI short form). */
export function parseStep(spec: string): EffectStep {
  const [left, window] = spec.split("@");
  const [effect, paramText] = left.split(":");
  const params: Record<string, string> = {};
  if (paramText) {
    for (const pair of paramText.split(",")) {
      const [k, v] = pair.split("=");
      if (!k || v === undefined) throw new Error(`Malformed param in "${spec}". Use key=value.`);
      params[k.trim()] = v.trim();
    }
  }
  const step: EffectStep = { effect: effect.trim(), params };
  if (window) {
    const [from, to] = window.split("-").map((x) => (x === "" ? undefined : Number(x)));
    if (from !== undefined) step.from = from;
    if (to !== undefined) step.to = to;
  }
  return step;
}
