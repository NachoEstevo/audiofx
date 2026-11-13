import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The studio's local library: voices, music and effects the user already has on disk, so effects can be
 * tried on real material. Only files from these folders are listed and served:
 *   1. AUDIOFX_LIBRARY (folders separated by ";" on Windows or ":" on Unix), otherwise
 *   2. ~/.audiofx/library.json → { "folders": ["C:/...", ...] }, otherwise
 *   3. ~/Music and ~/Downloads.
 * ~/.audiofx/generated (ElevenLabs generations) is always included.
 */

export type LibraryKind = "voice" | "music" | "sfx" | "mix";

export interface LibraryItem {
  id: string;
  name: string;
  folder: string;
  kind: LibraryKind;
  sizeMb: number;
  modified: number;
  /** Made with ElevenLabs from the studio or `sfx generate`. */
  generated: boolean;
}

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".aif", ".aiff"]);
const SKIP_DIRS = /^(node_modules|\.git|\.venv|venv|site-packages|__pycache__|dist|build|\..+)$/i;
const MAX_ITEMS = 400;
const MAX_DEPTH = 5;

export const AUDIOFX_HOME = process.env.AUDIOFX_HOME ?? path.join(homedir(), ".audiofx");
export const CONFIG_FILE = path.join(AUDIOFX_HOME, "library.json");
export const GENERATED_DIR = path.join(AUDIOFX_HOME, "generated");

export function libraryFolders(): string[] {
  const env = process.env.AUDIOFX_LIBRARY;
  if (env) return env.split(path.delimiter).filter(Boolean);
  if (existsSync(CONFIG_FILE)) {
    try {
      const folders = (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as { folders?: string[] }).folders;
      if (folders?.length) return folders;
    } catch {
      // Unreadable config: fall back to the default folders.
    }
  }
  return [path.join(homedir(), "Music"), path.join(homedir(), "Downloads")];
}

/** Classification by name: good enough to sort the list; the user still sees the file name. */
export function classify(file: string, bytes: number): LibraryKind {
  const name = path.basename(file).toLowerCase();
  // Mixes first: "master-voiceover" or "foley-mix" are not a loose voice or effect.
  if (/mix|mezcla|master|take|audicion|stem/.test(name)) return "mix";
  if (/voice|voz|locuci|narra|dialog|entrevista|interview|speech|\bvo\b/.test(name)) return "voice";
  if (/whoosh|swoosh|riser|golpe|hit|impact|boom|pop|switch|click|tecla|tipeo|sfx|foley|stinger/.test(name)) return "sfx";
  if (/music|musica|song|track|beat|loop/.test(name)) return "music";
  return bytes < 700 * 1024 ? "sfx" : "music";
}

/** Generated files are named "<kind>-<prompt>-<time>": the prefix is the truth, not the prompt. */
function generatedKind(name: string): LibraryKind {
  if (name.startsWith("voice-")) return "voice";
  if (name.startsWith("music-")) return "music";
  return "sfx";
}

/** A generation's prompt from its .json sidecar: a readable name instead of the slugged file name. */
function promptOf(file: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(file.replace(/\.[^.]+$/, ".json"), "utf8")) as { prompt?: unknown };
    return typeof meta.prompt === "string" && meta.prompt.trim() ? meta.prompt.trim() : null;
  } catch {
    return null;
  }
}

const ORDER: Record<LibraryKind, number> = { voice: 0, music: 1, sfx: 2, mix: 3 };

/** "Launch film · v2": the project (first subfolder) and the file's folder. */
function shortFolder(root: string, dir: string): string {
  const rel = path.relative(root, dir).split(path.sep).filter(Boolean);
  if (!rel.length) return path.basename(root);
  return [...new Set([rel[0], rel[rel.length - 1]])].join(" · ");
}

export function scanLibrary(): { items: LibraryItem[]; paths: Map<string, string>; folders: string[] } {
  const folders = libraryFolders();
  const found: (LibraryItem & { file: string })[] = [];

  const walk = (dir: string, depth: number, root: string, generated: boolean) => {
    if (depth > MAX_DEPTH || found.length >= MAX_ITEMS * 2) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // isSymbolicLink first: junctions and links to other folders are never followed.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.test(entry.name)) walk(full, depth + 1, root, generated);
      } else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        // Generated sound effects can be tiny; files picked up from regular folders must be real audio.
        if (!generated && st.size < 60 * 1024) continue;
        found.push({
          id: createHash("sha1").update(full).digest("hex").slice(0, 12),
          name: (generated && promptOf(full)) || path.basename(entry.name, path.extname(entry.name)),
          folder: generated ? "ElevenLabs" : shortFolder(root, dir),
          kind: generated ? generatedKind(entry.name) : classify(full, st.size),
          sizeMb: Math.round((st.size / 1024 / 1024) * 10) / 10,
          modified: st.mtimeMs,
          generated,
          file: full,
        });
      }
    }
  };
  if (existsSync(GENERATED_DIR)) walk(GENERATED_DIR, 0, GENERATED_DIR, true);
  for (const folder of folders) if (existsSync(folder)) walk(folder, 0, folder, false);

  found.sort((a, b) => Number(b.generated) - Number(a.generated) || ORDER[a.kind] - ORDER[b.kind] || b.modified - a.modified);
  const kept = found.slice(0, MAX_ITEMS);
  return {
    items: kept.map(({ file: _file, ...item }) => item),
    paths: new Map(kept.map((i) => [i.id, i.file])),
    folders,
  };
}
