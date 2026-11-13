import { EFFECTS } from "../../src/core/registry";
import { CATEGORY_LABELS, type Category, type EffectStep, type ParamValue } from "../../src/core/types";

/**
 * A recipe step. Times are relative to the "moment" the user marks on the waveform:
 * `at` is added to the moment and `window` is [from, to, fade] relative to the moment.
 */
export interface RecipeStep {
  effect: string;
  params?: Record<string, ParamValue>;
  at?: number;
  window?: [number, number, number];
}

export interface Sound {
  id: string;
  name: string;
  hint: string;
  color: string;
  /** true when it depends on the marked moment (hits, risers, cuts). */
  timed: boolean;
  steps: RecipeStep[];
  group: "moments" | "treatments" | "effects";
  category?: Category;
}

export const CATEGORY_COLORS: Record<Category, string> = {
  cinema: "#F75001",
  filter: "#0D9488",
  space: "#1A73F2",
  era: "#D97706",
  modulation: "#7C3AED",
  character: "#DB2777",
  narrative: "#4F46E5",
  transition: "#16A34A",
  dynamics: "#475569",
};

/** Cinema moments: layers that land on the marked instant, like in a launch cut. */
const MOMENTS: Omit<Sound, "group" | "timed">[] = [
  {
    id: "m-hit",
    name: "Hit on the cut",
    hint: "Riser, gap and hit",
    color: "#F75001",
    steps: [{ effect: "riser", at: 0, params: { length: 2.5 } }, { effect: "drop-gap", at: 0, params: { gap: 0.4 } }, { effect: "hit", at: 0 }],
  },
  {
    id: "m-reveal",
    name: "Reveal",
    hint: "The product lands",
    color: "#FF3B30",
    steps: [
      { effect: "riser", at: 0, params: { length: 4, tonal: 0.8 } },
      { effect: "drop-gap", at: 0, params: { gap: 0.6 } },
      { effect: "hit", at: 0, params: { size: 0.85 } },
      { effect: "sub-drop", at: 0 },
    ],
  },
  {
    id: "m-title",
    name: "Trailer title",
    hint: "Braam and sub",
    color: "#B91C1C",
    steps: [{ effect: "braam", at: 0 }, { effect: "sub-drop", at: 0, params: { length: 3.5 } }],
  },
  {
    id: "m-explosion",
    name: "Explosion",
    hint: "Hit and shell shock",
    color: "#EA580C",
    steps: [
      { effect: "hit", at: 0, params: { size: 1, tone: "dark" } },
      { effect: "sub-drop", at: 0 },
      { effect: "tinnitus", window: [0.05, 5, 1.5] },
    ],
  },
  { id: "m-whoosh", name: "Text fly-in", hint: "Side-to-side whoosh", color: "#1A73F2", steps: [{ effect: "whoosh", at: 0 }] },
  {
    id: "m-ending",
    name: "Cut to black",
    hint: "Cut with tail and sub",
    color: "#111827",
    steps: [{ effect: "stop-tail", at: 0 }, { effect: "sub-drop", at: 0, params: { level: -4 } }],
  },
  { id: "m-gap", name: "Silence before", hint: "Everything drops out and returns", color: "#64748B", steps: [{ effect: "drop-gap", at: 0, params: { gap: 0.6 } }] },
  { id: "m-echo", name: "Echoed word", hint: "End of a line", color: "#0EA5E9", steps: [{ effect: "throw", at: 0, params: { kind: "echo" } }] },
  { id: "m-glitch", name: "Tech glitch", hint: "Stutter", color: "#7C3AED", steps: [{ effect: "stutter", at: 0 }] },
  {
    id: "m-splash",
    name: "Dive underwater",
    hint: "Whoosh, then underwater",
    color: "#2563EB",
    steps: [{ effect: "whoosh", at: -0.2, params: { length: 0.6, direction: "center" } }, { effect: "underwater", window: [0, 6, 0.3] }],
  },
];

/** Treatments: change how the whole source sounds. */
const TREATMENTS: Omit<Sound, "group" | "timed">[] = [
  { id: "t-trailer", name: "Trailer voice", hint: "Deep and epic", color: "#F75001", steps: [{ effect: "trailer-voice" }] },
  { id: "t-archival", name: "Archival voice", hint: "80s interview", color: "#A16207", steps: [{ effect: "archival" }] },
  { id: "t-call", name: "Phone call", hint: "Landline", color: "#F59E0B", steps: [{ effect: "telephone" }] },
  { id: "t-cell", name: "Cellphone", hint: "Signal breaking up", color: "#0EA5E9", steps: [{ effect: "cellphone" }] },
  { id: "t-underwater", name: "Underwater", hint: "Submerged", color: "#2563EB", steps: [{ effect: "underwater" }] },
  { id: "t-radio", name: "Vintage radio", hint: "AM transistor", color: "#B45309", steps: [{ effect: "am-radio" }] },
  { id: "t-flashback", name: "Flashback", hint: "Distant memory", color: "#A855F7", steps: [{ effect: "flashback" }] },
  { id: "t-dream", name: "Dream", hint: "Wide and hazy", color: "#6366F1", steps: [{ effect: "dream" }] },
  { id: "t-wall", name: "Behind the wall", hint: "Next room", color: "#78716C", steps: [{ effect: "muffled" }] },
  {
    id: "t-stadium",
    name: "Stadium",
    hint: "Megaphone and reverb",
    color: "#16A34A",
    steps: [{ effect: "megaphone" }, { effect: "reverb", params: { space: "stadium", mix: 0.4 } }],
  },
  { id: "t-vinyl", name: "Vinyl", hint: "Dust and scratches", color: "#44403C", steps: [{ effect: "vinyl" }] },
  {
    id: "t-podcast",
    name: "Podcast voice",
    hint: "Clean at −16 LUFS",
    color: "#0C0A09",
    steps: [{ effect: "voice-clean" }, { effect: "loudness", params: { target: -16 } }],
  },
];

const isTimed = (steps: RecipeStep[]) => steps.some((s) => s.at !== undefined || s.window !== undefined);

export const SOUNDS: Sound[] = [
  ...MOMENTS.map((m) => ({ ...m, group: "moments" as const, timed: isTimed(m.steps) })),
  ...TREATMENTS.map((t) => ({ ...t, group: "treatments" as const, timed: isTimed(t.steps) })),
  ...EFFECTS.map((e) => ({
    id: `e-${e.id}`,
    name: e.name,
    hint: e.description,
    color: CATEGORY_COLORS[e.category],
    group: "effects" as const,
    category: e.category,
    timed: !!e.timed,
    steps: [e.timed ? { effect: e.id, at: 0 } : { effect: e.id }],
  })),
];

export const GROUP_LABELS = { moments: "Moments", treatments: "Treatments", effects: "All effects" } as const;
export { CATEGORY_LABELS };

/** Turns a recipe into absolute steps for the marked moment. */
export function stepsAt(steps: RecipeStep[], moment: number, duration: number): EffectStep[] {
  const clampT = (t: number) => Math.max(0, Math.min(Math.max(0, duration), t));
  return steps.map((s) => {
    const step: EffectStep = { effect: s.effect, params: { ...s.params } };
    if (s.at !== undefined) step.params!.at = Math.round(clampT(moment + s.at) * 100) / 100;
    if (s.window) {
      step.from = clampT(moment + s.window[0]);
      step.to = Math.max(step.from + 0.1, clampT(moment + s.window[1]));
      step.fade = s.window[2];
    }
    return step;
  });
}
