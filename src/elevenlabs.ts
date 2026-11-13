import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIOFX_HOME, GENERATED_DIR } from "./library.js";

/**
 * Minimal ElevenLabs client for the three generators that matter for video sound design: sound effects,
 * speech and music. It talks to the public REST API with `fetch` (no SDK dependency) and saves every
 * generation in ~/.audiofx/generated so it shows up in the studio library and can be reused with effects.
 *
 * API reference: https://elevenlabs.io/docs/api-reference (sound-generation, text-to-speech, music).
 */

const API = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type GenerateKind = "sfx" | "voice" | "music";

export interface GenerateRequest {
  kind: GenerateKind;
  /** Sound or music description, or the text to speak. */
  prompt: string;
  /** Seconds. Sound effects: 0.5–30 (omit to let the model pick). Music: 3–600. */
  duration?: number;
  /** Sound effects only: a seamless loop (ambiences, beds). */
  loop?: boolean;
  /** Sound effects only: 0–1, how literally to follow the prompt (API default 0.3). */
  influence?: number;
  /** Speech only: voice id. Defaults to George, a premade voice every plan can use. */
  voice?: string;
  /** Model override. Defaults: eleven_text_to_sound_v3, eleven_v4, the API's default music model. */
  model?: string;
  /** Music only: guarantee no vocals. */
  instrumental?: boolean;
}

export interface Generation {
  file: string;
  kind: GenerateKind;
  prompt: string;
  bytes: number;
}

/** George (narrative), from the official ElevenLabs text-to-speech skill: a premade voice free plans can use. */
export const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

const KEY_NAME = "ELEVENLABS_API_KEY";

/** Reads KEY=value pairs from a .env file without adding a dependency. */
function readDotEnv(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, "").trim() || undefined;
  }
  return undefined;
}

/**
 * Where the key comes from, in order: the environment, a .env in the current folder (what
 * `npx @elevenlabs/cli onboard init` writes), a .env in this repo, and ~/.audiofx/.env.
 * Returns where it was found, never the key itself, so callers can show it safely.
 */
export function findApiKey(): { key: string; source: string } | null {
  if (process.env[KEY_NAME]) return { key: process.env[KEY_NAME]!, source: `${KEY_NAME} environment variable` };
  const candidates = [path.join(process.cwd(), ".env"), path.join(ROOT, ".env"), path.join(AUDIOFX_HOME, ".env")];
  for (const file of [...new Set(candidates)]) {
    const key = readDotEnv(file);
    if (key) return { key, source: file };
  }
  return null;
}

export const SETUP_HINT =
  `No ElevenLabs API key found. Run \`npx -y @elevenlabs/cli@latest onboard init\` in this folder (it signs you in and writes a .env), ` +
  `or set ${KEY_NAME}, or put ${KEY_NAME}=... in ~/.audiofx/.env. Keys: https://elevenlabs.io/app/settings/api-keys`;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled"
  );
}

async function explain(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    const d = body.detail as { message?: string; status?: string } | { msg?: string }[] | string | undefined;
    detail = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : (d?.message ?? d?.status ?? "");
  } catch {
    // Not JSON: the status line is all there is.
  }
  const hint =
    res.status === 401
      ? " Check the API key."
      : res.status === 402
        ? " This voice or model needs a paid plan; premade voices like George work on every plan."
        : res.status === 429
          ? " Rate limit or quota reached; try again later."
          : "";
  return `ElevenLabs ${res.status}${detail ? `: ${detail}` : ""}.${hint}`;
}

function request(req: GenerateRequest): { url: string; body: Record<string, unknown> } {
  const prompt = req.prompt.trim();
  if (!prompt) throw new Error("Write a prompt (or the text to speak).");
  const format = "output_format=mp3_44100_128";
  switch (req.kind) {
    case "sfx":
      return {
        url: `${API}/v1/sound-generation?${format}`,
        body: {
          text: prompt,
          model_id: req.model ?? "eleven_text_to_sound_v3",
          ...(req.duration !== undefined && { duration_seconds: clamp(req.duration, 0.5, 30) }),
          ...(req.influence !== undefined && { prompt_influence: clamp(req.influence, 0, 1) }),
          ...(req.loop && { loop: true }),
        },
      };
    case "voice":
      return {
        url: `${API}/v1/text-to-speech/${encodeURIComponent(req.voice ?? DEFAULT_VOICE)}?${format}`,
        body: { text: prompt, model_id: req.model ?? "eleven_v4" },
      };
    case "music":
      return {
        url: `${API}/v1/music?${format}`,
        body: {
          prompt,
          ...(req.model && { model_id: req.model }),
          ...(req.duration !== undefined && { music_length_ms: Math.round(clamp(req.duration, 3, 600) * 1000) }),
          ...(req.instrumental && { force_instrumental: true }),
        },
      };
  }
}

/** Generates audio with ElevenLabs and saves it (mp3 + a .json with the prompt) in ~/.audiofx/generated. */
export async function generate(req: GenerateRequest): Promise<Generation> {
  const auth = findApiKey();
  if (!auth) throw new Error(SETUP_HINT);
  const { url, body } = request(req);
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": auth.key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explain(res));
  const audio = Buffer.from(await res.arrayBuffer());
  mkdirSync(GENERATED_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const file = path.join(GENERATED_DIR, `${req.kind}-${slug(req.prompt)}-${stamp}.mp3`);
  writeFileSync(file, audio);
  const { prompt: _prompt, ...params } = req;
  writeFileSync(file.replace(/\.mp3$/, ".json"), JSON.stringify({ prompt: req.prompt, params: { ...params, ...body, text: undefined, prompt: undefined }, created: new Date().toISOString() }, null, 2));
  return { file, kind: req.kind, prompt: req.prompt, bytes: audio.length };
}
