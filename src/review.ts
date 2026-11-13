import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEffect, resolveParams } from "./core/registry.js";
import type { EffectDefinition, ParamValue } from "./core/types.js";
import { AUDIOFX_HOME } from "./library.js";

/**
 * The user's review of the catalog, by ear: keep, tweak or cut for each effect, with an optional note and,
 * for a tweak, the params he tried. It lives in ~/.audiofx/review.json and later decides which effects stay,
 * get retuned or get removed. Reading never fails (a missing or unreadable file is an empty review) and a
 * file that cannot be read is moved aside on the next write, never overwritten.
 */

export const REVIEW_FILE = path.join(AUDIOFX_HOME, "review.json");
export const VERDICTS = ["keep", "tweak", "cut"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MAX_NOTE_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 200;

export interface ReviewEntry {
  verdict: Verdict;
  note?: string;
  /** The non-default params he had when he marked it (a tweak). */
  params?: Record<string, ParamValue>;
  /** Name of the audio he listened on. */
  source?: string;
  /** ISO time of the verdict. */
  reviewed: string;
}

export interface Review {
  version: 1;
  /** ISO time of the last write; null while nothing has been reviewed. */
  updated: string | null;
  effects: Record<string, ReviewEntry>;
}

export interface ReviewRead {
  review: Review;
  /** Why the file could not be read in full; it is kept aside on the next write. */
  problem: string | null;
}

export interface ReviewChange {
  effect: string;
  /** The saved entry, or null when the verdict was cleared. */
  entry: ReviewEntry | null;
  updated: string | null;
  /** File name the unreadable review was moved to before this write, if any. */
  keptAside: string | null;
}

/** A request the review cannot accept: the server answers it with `status`. */
export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const empty = (): Review => ({ version: 1, updated: null, effects: {} });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isParamValue = (v: unknown): v is ParamValue => typeof v === "number" || typeof v === "string" || typeof v === "boolean";

/** An entry read from disk, or null when it is malformed. Effects no longer in the catalog are kept as they are. */
function readEntry(raw: unknown): ReviewEntry | null {
  if (!isObject(raw) || !VERDICTS.includes(raw.verdict as Verdict) || typeof raw.reviewed !== "string") return null;
  if (raw.note !== undefined && typeof raw.note !== "string") return null;
  if (raw.source !== undefined && typeof raw.source !== "string") return null;
  if (raw.params !== undefined && !(isObject(raw.params) && Object.values(raw.params).every(isParamValue))) return null;
  const entry: ReviewEntry = { verdict: raw.verdict as Verdict, reviewed: raw.reviewed };
  if (raw.note) entry.note = raw.note as string;
  if (raw.params) entry.params = raw.params as Record<string, ParamValue>;
  if (raw.source) entry.source = raw.source as string;
  return entry;
}

export function readReview(): ReviewRead {
  if (!existsSync(REVIEW_FILE)) return { review: empty(), problem: null };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(REVIEW_FILE, "utf8"));
  } catch (error) {
    return { review: empty(), problem: `review.json could not be read (${(error as Error).message}).` };
  }
  if (!isObject(data) || data.version !== 1 || !isObject(data.effects)) {
    return { review: empty(), problem: "review.json is not a version 1 review." };
  }
  const entries = Object.entries(data.effects).map(([id, raw]) => [id, readEntry(raw)] as const);
  const valid = entries.filter((e): e is readonly [string, ReviewEntry] => e[1] !== null);
  const skipped = entries.length - valid.length;
  // fromEntries defines own properties: an id like "__proto__" in a hand-edited file stays a plain key.
  const review: Review = { version: 1, updated: typeof data.updated === "string" ? data.updated : null, effects: Object.fromEntries(valid) };
  return { review, problem: skipped ? `${skipped} ${skipped === 1 ? "entry" : "entries"} in review.json could not be read.` : null };
}

/** Moves a review that could not be read in full next to it, so a write never loses it. */
function keepAside(): string | null {
  if (!existsSync(REVIEW_FILE)) return null;
  const name = `review.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  renameSync(REVIEW_FILE, path.join(path.dirname(REVIEW_FILE), name));
  return name;
}

/** Temp file and rename: a reader never sees half a file, and a failed write leaves the old one intact. */
function writeReview(review: Review) {
  mkdirSync(path.dirname(REVIEW_FILE), { recursive: true });
  const temp = `${REVIEW_FILE}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(review, null, 2)}\n`, "utf8");
    renameSync(temp, REVIEW_FILE);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function change(effect: string, entry: ReviewEntry | null, mutate: (review: Review) => void): ReviewChange {
  const { review, problem } = readReview();
  const keptAside = problem ? keepAside() : null;
  mutate(review);
  review.updated = new Date().toISOString();
  writeReview(review);
  return { effect, entry, updated: review.updated, keptAside };
}

function catalogEffect(id: string): EffectDefinition {
  try {
    return getEffect(id);
  } catch (error) {
    throw new ReviewError((error as Error).message, 404);
  }
}

/** Validates and saves one verdict. Params are checked against the effect and stored as given, coerced. */
export function setVerdict(effectId: string, input: unknown): ReviewChange {
  const effect = catalogEffect(effectId);
  if (!isObject(input)) throw new ReviewError("Send a JSON object: { verdict, note?, params?, source? }.");
  if (!VERDICTS.includes(input.verdict as Verdict)) throw new ReviewError(`verdict must be one of: ${VERDICTS.join(", ")}.`);
  const entry: ReviewEntry = { verdict: input.verdict as Verdict, reviewed: new Date().toISOString() };

  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string") throw new ReviewError("note must be text.");
    const note = input.note.trim();
    if (note.length > MAX_NOTE_LENGTH) throw new ReviewError(`note is too long: ${note.length} characters, the limit is ${MAX_NOTE_LENGTH}.`);
    if (note) entry.note = note;
  }

  if (input.params !== undefined && input.params !== null) {
    if (!isObject(input.params) || !Object.values(input.params).every(isParamValue)) {
      throw new ReviewError("params must be an object of numbers, text or true/false.");
    }
    const given = input.params as Record<string, ParamValue>;
    let resolved: Record<string, ParamValue>;
    try {
      resolved = resolveParams(effect, given);
    } catch (error) {
      throw new ReviewError((error as Error).message);
    }
    const keys = Object.keys(given);
    if (keys.length) entry.params = Object.fromEntries(keys.map((k) => [k, resolved[k]]));
  }

  if (typeof input.source === "string" && input.source.trim()) entry.source = input.source.trim().slice(0, MAX_SOURCE_LENGTH);

  return change(effect.id, entry, (review) => {
    review.effects[effect.id] = entry;
  });
}

/** Clears a verdict. Clearing one that is not there is a no-op; an id that is neither in the catalog nor in the review is an error. */
export function clearVerdict(effectId: string): ReviewChange {
  const { review } = readReview();
  if (!Object.hasOwn(review.effects, effectId)) {
    catalogEffect(effectId);
    return { effect: effectId, entry: null, updated: review.updated, keptAside: null };
  }
  return change(effectId, null, (r) => {
    delete r.effects[effectId];
  });
}
