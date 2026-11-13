import { getEffect, resolveParams } from "../../src/core/registry";
import type { EffectStep } from "../../src/core/types";
import type { Step } from "@/components/chain";

let keySeq = 0;

/** A chain step as the step cards edit it: params resolved, a UI key, the window switch and bypass. */
export const toStep = (s: EffectStep): Step => ({
  key: `k${++keySeq}`,
  effect: s.effect,
  params: resolveParams(getEffect(s.effect), s.params),
  windowed: s.from !== undefined || s.to !== undefined,
  bypassed: false,
  from: s.from ?? 0,
  to: s.to ?? 2,
  fade: s.fade ?? 0.25,
  mix: s.mix ?? 1,
});

/** What goes to the compiler: no UI keys, no bypassed steps, and no window unless one was asked for. */
export function fromSteps(steps: Step[]): EffectStep[] {
  return steps.filter((s) => !s.bypassed).map(({ effect, params, windowed, from, to, fade, mix }) => {
    const step: EffectStep = { effect, params };
    if (windowed) Object.assign(step, { from, to, fade });
    if (mix !== undefined && mix < 1) step.mix = mix;
    return step;
  });
}
