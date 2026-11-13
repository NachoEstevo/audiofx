import { EFFECTS, resolveParams } from "../../src/core/registry";
import { CATEGORY_LABELS, type Category, type EffectDefinition, type ParamSpec, type Params, type ParamValue } from "../../src/core/types";

/** Mirrors src/review.ts (the server validates; this is what the screen reads and sends). */
export const VERDICTS = ["keep", "tweak", "cut"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MAX_NOTE_LENGTH = 1000;

export interface ReviewEntry {
  verdict: Verdict;
  note?: string;
  params?: Record<string, ParamValue>;
  source?: string;
  reviewed: string;
}
export type Draft = Omit<ReviewEntry, "reviewed">;
export type Entries = Record<string, ReviewEntry>;

export type Filter = "all" | "todo" | Verdict;
export const FILTER_LABELS: Record<Filter, string> = { all: "All", todo: "Not reviewed", keep: "Keep", tweak: "Tweak", cut: "Cut" };

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const needsFile = (e: EffectDefinition) => e.params.some((p) => p.type === "file");

/** What he reviews by ear: every effect except those that need a file (layer), by category in catalog order. */
export const REVIEWABLE: EffectDefinition[] = CATEGORIES.flatMap((c) => EFFECTS.filter((e) => e.category === c && !needsFile(e)));
export const UNLISTED = EFFECTS.filter(needsFile).map((e) => e.name);

export function groupByCategory(effects: EffectDefinition[]) {
  return CATEGORIES.map((category) => ({ category, effects: effects.filter((e) => e.category === category) })).filter((g) => g.effects.length);
}

export function matchesQuery(effect: EffectDefinition, q: string) {
  if (!q) return true;
  return `${effect.name} ${effect.id} ${effect.description} ${effect.tags.join(" ")} ${CATEGORY_LABELS[effect.category]}`.toLowerCase().includes(q);
}

export function passesFilter(effect: EffectDefinition, entries: Entries, filter: Filter) {
  const verdict = entries[effect.id]?.verdict;
  return filter === "all" || (filter === "todo" ? !verdict : verdict === filter);
}

/** The effects after `from` in catalog order (wrapping around) that have no verdict yet. */
export function unreviewedAfter(from: string, entries: Entries): string[] {
  const start = REVIEWABLE.findIndex((e) => e.id === from);
  const ids: string[] = [];
  for (let i = 1; i <= REVIEWABLE.length; i++) {
    const id = REVIEWABLE[(start + i) % REVIEWABLE.length].id;
    if (!entries[id]) ids.push(id);
  }
  return ids;
}

/** Params he can change here: the moment of a timed effect comes from the waveform, not from a slider. */
export function editableSpecs(effect: EffectDefinition): ParamSpec[] {
  return effect.params.filter((p) => p.type !== "file" && !(effect.timed && p.id === "at"));
}

/** Where a review starts on an effect: the params saved with a tweak, else the defaults. */
export function initialParams(effect: EffectDefinition, entry?: ReviewEntry): Params {
  try {
    return resolveParams(effect, entry?.params);
  } catch {
    // Saved params the effect no longer accepts: start from the defaults.
    return resolveParams(effect);
  }
}

export function changedParams(specs: ParamSpec[], params: Params): Record<string, ParamValue> {
  return Object.fromEntries(specs.filter((s) => params[s.id] !== undefined && params[s.id] !== s.default).map((s) => [s.id, params[s.id]]));
}

export function sameParams(a: Record<string, ParamValue> | undefined, b: Record<string, ParamValue> | undefined) {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => a![k] === b?.[k]);
}

export async function fetchReview(): Promise<{ entries: Entries; problem: string | null }> {
  const res = await fetch("/api/review");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return { entries: data.review.effects, problem: data.problem };
}

/** Saves one verdict (or clears it with null). Throws with the server's reason when it is rejected. */
export async function saveEntry(effectId: string, draft: Draft | null): Promise<{ keptAside: string | null }> {
  const url = `/api/review/${encodeURIComponent(effectId)}`;
  const res = await fetch(url, draft ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) } : { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return { keptAside: data.keptAside ?? null };
}
