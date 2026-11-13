import { cinemaEffects } from "./effects/cinema.js";
import { dynamicsEffects } from "./effects/dynamics.js";
import { eraEffects } from "./effects/era.js";
import { filterEffects } from "./effects/filters.js";
import { layerEffects } from "./effects/layer.js";
import { modulationEffects } from "./effects/modulation.js";
import { narrativeEffects, transitionEffects } from "./effects/narrative.js";
import { spaceEffects } from "./effects/space.js";
import type { EffectDefinition, ParamSpec, Params, ParamValue } from "./types.js";

export const EFFECTS: readonly EffectDefinition[] = [
  ...cinemaEffects,
  ...layerEffects,
  ...filterEffects,
  ...spaceEffects,
  ...eraEffects,
  ...modulationEffects,
  ...narrativeEffects,
  ...transitionEffects,
  ...dynamicsEffects,
];

const byId = new Map<string, EffectDefinition>();
for (const effect of EFFECTS) {
  if (byId.has(effect.id)) throw new Error(`Duplicate effect: ${effect.id}`);
  byId.set(effect.id, effect);
}

export function getEffect(id: string): EffectDefinition {
  const effect = byId.get(id);
  if (!effect) {
    const close = EFFECTS.filter((e) => e.id.includes(id) || id.includes(e.id)).map((e) => e.id);
    const hint = close.length ? ` Did you mean ${close.join(", ")}?` : " Run `sfx list` to see the catalog.";
    throw new Error(`Unknown effect: "${id}".${hint}`);
  }
  return effect;
}

function coerce(spec: ParamSpec, raw: ParamValue): ParamValue {
  switch (spec.type) {
    case "number": {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) throw new Error(`"${spec.id}" must be a number (got ${JSON.stringify(raw)}).`);
      if (value < spec.min || value > spec.max) {
        throw new Error(`"${spec.id}" out of range: ${value}. Valid range ${spec.min}–${spec.max}${spec.unit ? " " + spec.unit : ""}.`);
      }
      return value;
    }
    case "enum": {
      const value = String(raw);
      if (!spec.options.includes(value)) throw new Error(`"${spec.id}" must be one of: ${spec.options.join(", ")} (got "${value}").`);
      return value;
    }
    case "bool": {
      if (typeof raw === "boolean") return raw;
      const s = String(raw).toLowerCase();
      if (["true", "1", "yes", "on"].includes(s)) return true;
      if (["false", "0", "no", "off"].includes(s)) return false;
      throw new Error(`"${spec.id}" must be true or false (got ${JSON.stringify(raw)}).`);
    }
    case "file":
      return String(raw).trim();
  }
}

/** Fills in defaults and validates. Rejects unknown params so agent mistakes surface. */
export function resolveParams(effect: EffectDefinition, params: Params = {}): Params {
  const known = new Set(effect.params.map((p) => p.id));
  for (const key of Object.keys(params)) {
    if (!known.has(key)) {
      const list = effect.params.map((p) => p.id).join(", ") || "(none)";
      throw new Error(`"${effect.id}" has no param "${key}". Params: ${list}.`);
    }
  }
  const resolved: Params = {};
  for (const spec of effect.params) {
    try {
      resolved[spec.id] = params[spec.id] === undefined ? spec.default : coerce(spec, params[spec.id]);
    } catch (error) {
      throw new Error(`${effect.id}: ${(error as Error).message}`);
    }
  }
  return resolved;
}

/** Serializable view of the catalog (no functions): used by the web app, the CLI and agents. */
export function describeEffect(effect: EffectDefinition) {
  const { build: _build, ...rest } = effect;
  return { ...rest, changesDuration: !!effect.changesDuration, hasTail: !!effect.hasTail, timed: !!effect.timed };
}

export type EffectInfo = ReturnType<typeof describeEffect>;

export function catalog(): EffectInfo[] {
  return EFFECTS.map(describeEffect);
}
