import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_REF, analyzeFile, measureSync } from "./core/index.js";
import { SAMPLES_DIR, sampleMeta, sampleName, scanLibrary, type LibraryKind, type SampleMeta, type Stem } from "./library.js";

/**
 * Recorded samples (from a sound library subscription, a generation, or the user's own files) live in
 * ~/.audiofx/samples, outside the repo, each with a .json that records where it came from.
 */

const EXT_BY_TYPE: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
};
const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".aif", ".aiff"]);

const slug = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .slice(0, 48) || "sample";

export interface AddSampleRequest {
  /** A local file, or an http(s) URL (e.g. the signed download link a sound library returns). */
  from: string;
  title?: string;
  /** The id in the library it came from. */
  id?: string;
  /** Which part of the recording this is (its full mix or a stem). With `id`, the pair is kept once. */
  stem?: Stem;
  source?: string;
  /** Default: music for a stem, sfx otherwise. */
  kind?: LibraryKind;
}

export interface SampleInfo extends SampleMeta {
  /** How the library shows it: the title and the stem ("Track title · drums"). */
  name: string;
  file: string;
  /** What to pass as `layer:file=...`. */
  ref: string;
}

const jsonOf = (file: string) => file.replace(/\.[^.]+$/, ".json");

/** The file already kept for this library id and stem: adding them again replaces it. */
function keptAs(id: string, stem: Stem | undefined): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(SAMPLES_DIR);
  } catch {
    return undefined;
  }
  return entries
    .filter((name) => AUDIO_EXT.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(SAMPLES_DIR, name))
    .find((file) => {
      const meta = sampleMeta(file);
      return meta.id === id && (meta.stem ?? null) === (stem ?? null);
    });
}

/**
 * Copies or downloads a sample into ~/.audiofx/samples and writes its .json (the download URL is not kept).
 * A library id is kept once per stem: adding the same pair again replaces the file, even under a new title.
 */
export async function addSample(req: AddSampleRequest): Promise<SampleInfo> {
  const remote = /^https?:\/\//i.test(req.from);
  let ext: string;
  let data: Buffer | null = null;
  if (remote) {
    const url = new URL(req.from);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}). Signed links expire: ask for a new one.`);
    data = Buffer.from(await res.arrayBuffer());
    const fromPath = path.extname(url.pathname).toLowerCase();
    ext = AUDIO_EXT.has(fromPath) ? fromPath : (EXT_BY_TYPE[(res.headers.get("content-type") ?? "").split(";")[0].trim()] ?? "");
    if (!ext) throw new Error("That link does not look like an audio file (wav, mp3, flac, ogg, m4a).");
  } else {
    if (!existsSync(req.from)) throw new Error(`File not found: ${req.from}`);
    ext = path.extname(req.from).toLowerCase();
    if (!AUDIO_EXT.has(ext)) throw new Error(`Not an audio file: ${req.from}`);
  }
  const title = req.title?.trim() || (remote ? "Sample" : path.basename(req.from, path.extname(req.from)));
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const base = `${slug(title)}${req.id ? `-${slug(req.id).slice(0, 8)}` : ""}${req.stem ? `-${req.stem}` : ""}`;
  const previous = req.id ? keptAs(req.id, req.stem) : undefined;
  // A name is taken by another sample's audio or .json (files that differ only in extension share a .json).
  const taken = (f: string) => f !== previous && (existsSync(f) || (existsSync(jsonOf(f)) && jsonOf(f) !== (previous && jsonOf(previous))));
  let file = path.join(SAMPLES_DIR, `${base}${ext}`);
  for (let i = 2; taken(file); i++) file = path.join(SAMPLES_DIR, `${base}-${i}${ext}`);
  if (data) writeFileSync(file, data);
  else if (path.resolve(req.from) !== file) copyFileSync(req.from, file);

  try {
    const [{ duration }, sync] = [await analyzeFile(file), await measureSync(file)];
    const meta: SampleMeta = {
      id: req.id,
      title,
      stem: req.stem,
      source: req.source ?? "local",
      kind: req.kind ?? (req.stem ? "music" : "sfx"),
      duration: Math.round(duration * 1000) / 1000,
      onset: sync.onset,
      peak: sync.peak,
      added: new Date().toISOString(),
    };
    writeFileSync(jsonOf(file), JSON.stringify(meta, null, 2));
    // The same id and stem kept under another name (an older title or format): the new file replaces it.
    if (previous && previous !== file) {
      rmSync(previous, { force: true });
      if (jsonOf(previous) !== jsonOf(file)) rmSync(jsonOf(previous), { force: true });
    }
    return { ...meta, name: sampleName(meta, title), file, ref: refOf(file) };
  } catch (error) {
    // Not decodable audio: don't leave it in the library.
    rmSync(file, { force: true });
    throw new Error(`Could not read that file as audio. ${(error as Error).message.split("\n").pop()}`);
  }
}

function refOf(file: string): string {
  const lib = scanLibrary();
  const id = [...lib.paths].find(([, f]) => f === file)?.[0];
  return id ? `${LIBRARY_REF}${id}` : file;
}

export function listSamples(): SampleInfo[] {
  const lib = scanLibrary();
  return lib.items
    .filter((i) => i.sample)
    .map((i) => {
      const file = lib.paths.get(i.id)!;
      const meta = sampleMeta(file);
      const title = (typeof meta.title === "string" && meta.title.trim()) || path.basename(file, path.extname(file));
      return { ...meta, title, name: i.name, kind: i.kind, file, ref: `${LIBRARY_REF}${i.id}` };
    });
}

/** Resolver for `library:<id>` references: scans the library once, on first use. */
export function libraryResolver(): (id: string) => string | undefined {
  let paths: Map<string, string> | undefined;
  return (id) => (paths ??= scanLibrary().paths).get(id);
}
