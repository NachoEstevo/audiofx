import { compile } from "../../src/core/compile";
import { DEFAULT_LOUDNESS, DUCK_DEFAULTS, type MixClip, type MixProject, type MixTrack, type TrackRole } from "../../src/core/mix";
import { getEffect, resolveParams } from "../../src/core/registry";
import type { EffectStep, Params } from "../../src/core/types";
import type { Step } from "@/components/chain";
import { fromSteps } from "./steps";

/**
 * The Mix screen's project: tracks of clips and moments on a timeline, edited through an undoable reducer
 * and turned into the engine's `MixProject` (src/core/mix.ts) to render. Clip files are what the server
 * issued (a source id or `library:<id>`); the browser never has paths.
 */

export type Role = TrackRole;
export type Align = NonNullable<MixClip["align"]>;

/** A hard cut the server found in the video (`detectCuts`). */
export interface Cut {
  time: number;
  /** How different the frame is from the previous one, 0–100. */
  score: number;
}

export interface ClipDoc {
  id: string;
  /** What the server mixes: a source id it issued, or `library:<id>`. */
  file: string;
  /** Source id of the normalized WAV the browser decodes for the waveform. */
  sourceId: string;
  name: string;
  /** The file's name for the exported project (`sfx mix` needs a path the studio never sees). */
  fileName: string;
  /** Seconds of audio in the file. */
  duration: number;
  /** Where the clip's sync point (its start, attack or loudest point, by `align`) lands on the timeline. */
  at: number;
  /** Seconds trimmed from the head of the file. */
  start: number;
  /** Seconds of the file used from `start`; null to the end. */
  length: number | null;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  align: Align;
  steps: Step[];
}

export type MomentKind = "hit" | "whoosh" | "riser-hit" | "braam" | "sub-drop";

/** A synthesized cinema moment: generator steps on an SFX track, all landing on `at`. */
export interface MomentDoc {
  id: string;
  kind: MomentKind;
  at: number;
  /** Each effect with its params, without `at` (the moment's). */
  steps: { effect: string; params: Params }[];
}

export interface TrackDoc {
  id: string;
  name: string;
  role: Role;
  gain: number;
  mute: boolean;
  solo: boolean;
  /** Music only: ducks under the voice tracks. */
  duck: boolean;
  duckDepth: number;
  duckRelease: number;
  clips: ClipDoc[];
  moments: MomentDoc[];
}

export interface MixDoc {
  tracks: TrackDoc[];
  /** Integrated loudness target of the master (LUFS); null leaves the level as mixed. */
  loudness: number | null;
}

/** What the inspector shows. */
export type Selection = { kind: "master" } | { kind: "track"; id: string } | { kind: "clip"; id: string } | { kind: "moment"; id: string };

export const ROLES: Role[] = ["voice", "music", "sfx"];
export const ROLE_LABELS: Record<Role, string> = { voice: "Voice", music: "Music", sfx: "SFX" };
/** Restrained accents: a dot in the track header and the tint of its waveforms. */
export const ROLE_COLORS: Record<Role, string> = { voice: "#1A73F2", music: "#0D9488", sfx: "#F75001" };

export const LOUDNESS_TARGETS: { value: number | null; label: string; hint: string }[] = [
  { value: -14, label: "Social", hint: "−14 LUFS" },
  { value: -16, label: "Podcast", hint: "−16 LUFS" },
  { value: -23, label: "Broadcast", hint: "−23 LUFS" },
  { value: null, label: "Off", hint: "As mixed" },
];

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

let seq = 0;
export const newId = (prefix: string) => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------------------------------------
// Building blocks

export function newTrack(role: Role, tracks: TrackDoc[]): TrackDoc {
  const same = tracks.filter((t) => t.role === role).length;
  let id: string = role;
  for (let k = 2; tracks.some((t) => t.id === id); k++) id = `${role}-${k}`;
  return {
    id,
    name: same ? `${ROLE_LABELS[role]} ${same + 1}` : ROLE_LABELS[role],
    role,
    gain: 0,
    mute: false,
    solo: false,
    duck: role === "music",
    duckDepth: DUCK_DEFAULTS.depth,
    duckRelease: DUCK_DEFAULTS.release,
    clips: [],
    moments: [],
  };
}

/** Voice, Music and SFX, master at −14 LUFS. */
export function initialDoc(): MixDoc {
  const tracks: TrackDoc[] = [];
  for (const role of ROLES) tracks.push(newTrack(role, tracks));
  return { tracks, loudness: DEFAULT_LOUDNESS };
}

/** Audio the server issued, ready to become a clip. */
export interface ClipSource {
  file: string;
  sourceId: string;
  name: string;
  fileName: string;
  duration: number;
  /** The server kept only the first part of a longer file: the clip uses exactly that much. */
  truncated?: boolean;
}

export function newClip(source: ClipSource, at: number, align: Align = "start"): ClipDoc {
  return {
    id: newId("c"),
    file: source.file,
    sourceId: source.sourceId,
    name: source.name,
    fileName: source.fileName,
    duration: source.duration,
    at: round(Math.max(0, at)),
    start: 0,
    length: source.truncated ? source.duration : null,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    align,
    steps: [],
  };
}

/** A sample lands by its attack; a whoosh by its loudest point (the synthesized one peaks on its moment too). */
export const sampleAlign = (name: string): Align => (/whoosh|swoosh|swish|swoop|pass[- ]?by|fly[- ]?by|transition/i.test(name) ? "peak" : "onset");

/** Seconds of the file the clip plays. */
export const clipLength = (c: Pick<ClipDoc, "length" | "duration" | "start">) => Math.max(0.01, Math.min(c.length ?? Infinity, c.duration - c.start));

/**
 * Where the clip sits on the timeline. `sync` is how far into the clip its sync point is (measured in the
 * browser for onset and peak; the server measures it again when it renders).
 */
export function clipSpan(c: ClipDoc, sync = 0): { from: number; to: number; anchor: number } {
  const from = c.at - (c.align === "start" ? 0 : sync);
  return { from, to: from + clipLength(c), anchor: c.at };
}

// ---------------------------------------------------------------------------------------------------------
// Moments

export const MOMENTS: { kind: MomentKind; label: string; short: string; hint: string; effects: string[] }[] = [
  { kind: "hit", label: "Hit on the cut", short: "Hit", hint: "Impact on the moment", effects: ["hit"] },
  { kind: "whoosh", label: "Whoosh", short: "Whoosh", hint: "Peaks on the moment", effects: ["whoosh"] },
  { kind: "riser-hit", label: "Riser + hit", short: "Riser + hit", hint: "Builds and lands on the moment", effects: ["riser", "hit"] },
  { kind: "braam", label: "Braam", short: "Braam", hint: "Starts on the moment", effects: ["braam"] },
  { kind: "sub-drop", label: "Sub drop", short: "Sub drop", hint: "Starts on the moment", effects: ["sub-drop"] },
];
export const momentInfo = (kind: MomentKind) => MOMENTS.find((m) => m.kind === kind)!;

export function newMoment(kind: MomentKind, at: number): MomentDoc {
  return {
    id: newId("m"),
    kind,
    at: round(Math.max(0, at)),
    steps: momentInfo(kind).effects.map((effect) => {
      const { at: _at, ...params } = resolveParams(getEffect(effect));
      return { effect, params };
    }),
  };
}

export const momentSteps = (m: MomentDoc): EffectStep[] => m.steps.map((s) => ({ effect: s.effect, params: { ...s.params, at: round(m.at) } }));

/** Seconds the moment's sound covers, as the cinema effects place it around `at` (without reverb tails). */
export function momentExtent(m: MomentDoc): { from: number; to: number } {
  let from = m.at;
  let to = m.at;
  for (const { effect, params } of m.steps) {
    const length = Number(params.length ?? 0);
    if (effect === "hit") to = Math.max(to, m.at + 1.2 + 3.5 * Number(params.size ?? 0.6));
    else if (effect === "riser") from = Math.min(from, m.at - length);
    else if (effect === "whoosh") {
      from = Math.min(from, m.at - length / 2);
      to = Math.max(to, m.at + length / 2);
    } else to = Math.max(to, m.at + length);
  }
  return { from: Math.max(0, from), to };
}

/** House guidance: one or two moments per 15 s, never a hit on every cut. */
const SUGGEST_SPACING = 4;
const SUGGEST_WINDOW = 15;

/**
 * A restrained set of moments on the strongest cuts: about 1.5 per 15 s and at most half the cuts (minus the
 * moments already there), at least 4 s apart and never more than two in any 15 s. The strongest cut gets a
 * riser and hit, other strong ones a hit, the rest a whoosh.
 */
export function suggestMoments(cuts: Cut[], duration: number, existing: number[]): MomentDoc[] {
  const ranked = cuts.filter((c) => c.time > 0.5 && c.time < duration - 0.5).sort((a, b) => b.score - a.score);
  const budget = Math.min(Math.max(1, Math.round((duration / SUGGEST_WINDOW) * 1.5)), Math.max(1, Math.floor(cuts.length / 2))) - existing.length;
  const taken = [...existing];
  const chosen: Cut[] = [];
  for (const cut of ranked) {
    if (chosen.length >= budget) break;
    if (taken.some((t) => Math.abs(t - cut.time) < SUGGEST_SPACING)) continue;
    if (taken.filter((t) => Math.abs(t - cut.time) < SUGGEST_WINDOW / 2).length >= 2) continue;
    chosen.push(cut);
    taken.push(cut.time);
  }
  return chosen
    .sort((a, b) => a.time - b.time)
    .map((cut) => newMoment(cut === ranked[0] && cut.time >= 2.5 ? "riser-hit" : cut.score >= 40 ? "hit" : "whoosh", cut.time));
}

// ---------------------------------------------------------------------------------------------------------
// Edits: pure functions of the document

const mapTracks = (doc: MixDoc, fn: (t: TrackDoc) => TrackDoc): MixDoc => ({ ...doc, tracks: doc.tracks.map(fn) });

/** The engine refuses fades longer than the clip: they shrink with it. */
function fitFades(c: ClipDoc): ClipDoc {
  const length = clipLength(c);
  const total = c.fadeIn + c.fadeOut;
  if (total <= length) return c;
  const k = length / total;
  return { ...c, fadeIn: round(c.fadeIn * k, 3), fadeOut: round(c.fadeOut * k, 3) };
}

export const editTrack = (doc: MixDoc, id: string, patch: Partial<TrackDoc>) => mapTracks(doc, (t) => (t.id === id ? { ...t, ...patch } : t));

export const editClip = (doc: MixDoc, id: string, patch: Partial<ClipDoc>) =>
  mapTracks(doc, (t) => (t.clips.some((c) => c.id === id) ? { ...t, clips: t.clips.map((c) => (c.id === id ? fitFades({ ...c, ...patch }) : c)) } : t));

export const editMoment = (doc: MixDoc, id: string, patch: Partial<MomentDoc>) =>
  mapTracks(doc, (t) => (t.moments.some((m) => m.id === id) ? { ...t, moments: t.moments.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : t));

export const addClip = (doc: MixDoc, trackId: string, clip: ClipDoc) => mapTracks(doc, (t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t));

export const addMoments = (doc: MixDoc, trackId: string, moments: MomentDoc[]) =>
  moments.length ? mapTracks(doc, (t) => (t.id === trackId ? { ...t, moments: [...t.moments, ...moments] } : t)) : doc;

/** Removes a clip or a moment. */
export const removeItem = (doc: MixDoc, id: string) =>
  mapTracks(doc, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id), moments: t.moments.filter((m) => m.id !== id) }));

/** A new track goes after the last one of its role. */
export function addTrack(doc: MixDoc, role: Role): { doc: MixDoc; track: TrackDoc } {
  const track = newTrack(role, doc.tracks);
  const last = doc.tracks.map((t) => t.role).lastIndexOf(role);
  const tracks = [...doc.tracks];
  tracks.splice(last < 0 ? tracks.length : last + 1, 0, track);
  return { doc: { ...doc, tracks }, track };
}

export const removeTrack = (doc: MixDoc, id: string): MixDoc => ({ ...doc, tracks: doc.tracks.filter((t) => t.id !== id) });

export function findClip(doc: MixDoc, id: string) {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

export function findMoment(doc: MixDoc, id: string) {
  for (const track of doc.tracks) {
    const moment = track.moments.find((m) => m.id === id);
    if (moment) return { track, moment };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Undo

export interface History {
  past: MixDoc[];
  present: MixDoc;
  future: MixDoc[];
  /** Edits with the same group within GROUP_MS (a slider drag, arrow nudges) make one undo step. */
  group: string | null;
  groupAt: number;
}

export type HistoryAction = { type: "edit"; apply: (doc: MixDoc) => MixDoc; group?: string; at?: number } | { type: "undo" } | { type: "redo" };

const HISTORY_LIMIT = 200;
const GROUP_MS = 900;

export const initialHistory = (doc: MixDoc): History => ({ past: [], present: doc, future: [], group: null, groupAt: 0 });

export function history(state: History, action: HistoryAction): History {
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future], group: null, groupAt: 0 };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1), group: null, groupAt: 0 };
  }
  const next = action.apply(state.present);
  if (next === state.present) return state;
  const at = action.at ?? 0;
  const merge = !!action.group && action.group === state.group && at - state.groupAt < GROUP_MS;
  return {
    past: merge ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    group: action.group ?? null,
    groupAt: at,
  };
}

// ---------------------------------------------------------------------------------------------------------
// To the engine

/** Seconds the chain's tail rings past the clip (compile pads reverbs and echoes). */
function chainTail(steps: Step[]): number {
  const list = fromSteps(steps);
  if (!list.length) return 0;
  try {
    return compile(list, { normalize: false }).tail;
  } catch {
    return 0;
  }
}

/** Where the last sound ends: the length of an audio-only mix. */
export function contentEnd(doc: MixDoc): number {
  let end = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.at + clipLength(clip) + chainTail(clip.steps));
    for (const moment of track.moments) end = Math.max(end, momentExtent(moment).to);
  }
  return end;
}

export const hasContent = (doc: MixDoc) => doc.tracks.some((t) => t.clips.length || t.moments.length);

function clipToProject(c: ClipDoc, file: string): MixClip {
  const clip: MixClip = { file, at: round(c.at) };
  if (c.start > 0) clip.start = round(c.start);
  if (c.length !== null) clip.length = round(c.length);
  if (c.gain) clip.gain = round(c.gain, 2);
  if (c.fadeIn > 0) clip.fadeIn = round(c.fadeIn, 3);
  if (c.fadeOut > 0) clip.fadeOut = round(c.fadeOut, 3);
  if (c.align !== "start") clip.align = c.align;
  const steps = fromSteps(c.steps);
  if (steps.length) clip.steps = steps;
  return clip;
}

function trackToProject(t: TrackDoc, fileOf: (c: ClipDoc) => string): MixTrack {
  const track: MixTrack = { id: t.id, name: t.name, role: t.role, clips: t.clips.map((c) => clipToProject(c, fileOf(c))) };
  if (t.gain) track.gain = round(t.gain, 2);
  if (t.mute) track.mute = true;
  if (t.solo) track.solo = true;
  if (t.role === "music") track.duck = t.duck ? { depth: t.duckDepth, release: t.duckRelease } : false;
  if (t.moments.length) track.steps = [...t.moments].sort((a, b) => a.at - b.at).flatMap(momentSteps);
  return track;
}

/** The project the server renders: clip files are server ids, `video` is the video id. */
export function toProject(doc: MixDoc, options: { video?: string; duration?: number }): MixProject {
  const project: MixProject = { version: 1, tracks: doc.tracks.map((t) => trackToProject(t, (c) => c.file)), master: { loudness: doc.loudness } };
  if (options.video) project.video = options.video;
  if (options.duration) project.duration = round(options.duration, 3);
  return project;
}

/**
 * The project as a file for `sfx mix`: library references stay `library:<id>`; uploads, demos and the video
 * appear by their file name, which the user points at his files (the studio never has paths).
 */
export function projectFile(doc: MixDoc, options: { videoName?: string; duration?: number }): { json: string; toPoint: string[] } {
  const toPoint = new Set<string>();
  const fileOf = (c: ClipDoc) => {
    if (c.file.startsWith("library:")) return c.file;
    toPoint.add(c.fileName);
    return c.fileName;
  };
  const project: MixProject = { version: 1, tracks: doc.tracks.map((t) => trackToProject(t, fileOf)), master: { loudness: doc.loudness } };
  if (options.videoName) {
    project.video = options.videoName;
    toPoint.add(options.videoName);
  }
  if (options.duration) project.duration = round(options.duration, 3);
  return { json: JSON.stringify(project, null, 2), toPoint: [...toPoint] };
}

// ---------------------------------------------------------------------------------------------------------
// Placing things

export interface SnapTarget {
  time: number;
  label: string;
}

/**
 * The closest snap: any of `edges` (seconds) within `tolerance` seconds of a target. Returns how far to
 * shift so that edge lands on the target.
 */
export function snapTo(edges: number[], targets: SnapTarget[], tolerance: number): { delta: number; target: SnapTarget } | null {
  let best: { delta: number; target: SnapTarget } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target.time - edge;
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
    }
  }
  return best;
}

/** To the nearest frame (to the hundredth of a second without a video). */
export const toFrame = (t: number, fps: number | null) => (fps ? Math.round(t * fps) / fps : Math.round(t * 100) / 100);
