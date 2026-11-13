import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { analyzeFile, applyToBuffer, prepareSteps, runFfmpeg, type EffectStep } from "./core/index.js";
import { findApiKey, generate, SETUP_HINT, type GenerateRequest } from "./elevenlabs.js";
import { scanLibrary } from "./library.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST = path.join(ROOT, "dist", "web");
const MAX_PREVIEW_SECONDS = 180;
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

interface Source {
  id: string;
  name: string;
  file: string;
  duration: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
};

/**
 * Demo sources generated locally (no licensed samples): a voice from Windows TTS and music, ambience,
 * impact and beat synthesized with ffmpeg. Cached between runs.
 */
const DEMO_CACHE = path.join(tmpdir(), "audiofx-demo-cache");
const DEMO_VERSION = "v4";

const VOICE_TEXT =
  "Hello, can you hear me? I'm calling from the ship's radio. It's starting to rain and the signal keeps cutting out. " +
  "If you get this message, meet me at the pier at nine.";

const TTS_SCRIPT = `param([string]$Out)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$pick = $voices | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
if ($pick) { $s.SelectVoice($pick.Name) }
$s.Rate = -1
$s.SetOutputToWaveFile($Out)
$s.Speak($env:AUDIOFX_TTS_TEXT)
$s.Dispose()
`;

/** Am–F–C–G progression at 100 bpm: pad, bass, arpeggio, kick and hi-hat. */
const MUSIC_EXPR = [
  "st(0,if(lt(mod(t,9.6),2.4),220,if(lt(mod(t,9.6),4.8),174.61,if(lt(mod(t,9.6),7.2),261.63,196))))",
  "st(1,if(lt(mod(t,9.6),2.4),1.1892,1.2599))",
  "st(2,min(1,mod(t,2.4)*12)*min(1,(2.4-mod(t,2.4))*12))",
  "st(3,mod(t,0.3))",
  "st(4,if(eq(mod(floor(t/0.3),4),0),1,if(eq(mod(floor(t/0.3),4),1),ld(1),if(eq(mod(floor(t/0.3),4),2),1.4983,2))))",
  [
    "0.04*ld(2)*(sin(2*PI*ld(0)*t)+0.4*sin(4*PI*ld(0)*t)+sin(2*PI*ld(0)*ld(1)*t)+0.3*sin(4*PI*ld(0)*ld(1)*t)+sin(2*PI*ld(0)*1.4983*t))",
    "0.24*ld(2)*sin(2*PI*ld(0)/4*t)*exp(-mod(t,0.6)*3)*min(1,mod(t,0.6)*80)",
    "0.05*sin(2*PI*ld(0)*2*ld(4)*t)*exp(-ld(3)*14)*min(1,ld(3)*200)",
    "0.45*sin(2*PI*(45+100*exp(-mod(t,0.6)*30))*mod(t,0.6))*exp(-mod(t,0.6)*8)",
    "0.06*(random(9)*2-1)*exp(-mod(t+0.3,0.6)*50)",
  ].join("+"),
].join(";");

/** Explosion: noise with a long decay plus a sub hit that falls in pitch. */
const IMPACT_EXPR =
  "st(0,max(0,t-0.3));if(gt(t,0.3),0.8*(random(9)*2-1)*exp(-ld(0)*2.2)*(0.4+0.6*exp(-ld(0)*12))+0.9*sin(2*PI*(28+90*exp(-ld(0)*6))*ld(0))*exp(-ld(0)*2),0)";

/** Kick, hi-hats and a sustained chord. */
const BEAT_EXPR = [
  "0.55*sin(2*PI*(45+110*exp(-mod(t,0.5)*25))*mod(t,0.5))*exp(-mod(t,0.5)*9)",
  "0.12*(random(0)*2-1)*exp(-mod(t+0.25,0.5)*45)",
  "0.07*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t)+0.5*sin(2*PI*440*t))*(0.6+0.4*sin(2*PI*0.25*t))",
].join("+");

const lavfi = (graph: string) => ["-f", "lavfi", "-i", graph];

const DEMOS = {
  voice: {
    name: "Voice (Windows TTS)",
    async make(out: string, workDir: string) {
      if (process.platform !== "win32") throw new Error("The demo voice uses Windows TTS; on this system, upload a recording.");
      const script = path.join(workDir, "tts.ps1");
      writeFileSync(script, TTS_SCRIPT, "utf8");
      const raw = path.join(workDir, `tts-${randomUUID()}.wav`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, raw], {
          windowsHide: true,
          env: { ...process.env, AUDIOFX_TTS_TEXT: VOICE_TEXT },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d));
        const timer = setTimeout(() => child.kill(), 30_000);
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && existsSync(raw)) resolve();
          else reject(new Error(`Windows TTS failed (code ${code}). ${stderr.trim().slice(0, 300)}`));
        });
      });
      // Half a second of air at the start and end, and dialogue level.
      await runFfmpeg(["-y", "-v", "error", "-i", raw, "-af", "adelay=500:all=1,apad=pad_dur=0.6,loudnorm=I=-18:TP=-2", "-ar", "48000", "-ac", "2", out]);
      rmSync(raw, { force: true });
    },
  },
  music: {
    name: "Music (synthesized progression)",
    make: (out: string) => runFfmpeg(["-y", "-v", "error", ...lavfi(`aevalsrc='${MUSIC_EXPR}':s=48000:d=9.6,lowpass=f=9000,volume=2dB`), "-ac", "2", out]),
  },
  ambience: {
    name: "Ambience (rain and city)",
    make: (out: string) =>
      runFfmpeg([
        "-y",
        "-v",
        "error",
        "-filter_complex",
        [
          "anoisesrc=c=pink:a=0.35:d=8:r=48000:seed=3,highpass=f=500,lowpass=f=8000[rain]",
          "anoisesrc=c=brown:a=0.5:d=8:r=48000:seed=7,lowpass=f=160[city]",
          "aevalsrc='if(lt(random(9),0.0005),random(8)*2-1,0)':s=48000:d=8,highpass=f=2500,volume=0.5[drops]",
          "[rain][city][drops]amix=inputs=3:normalize=0,volume=5dB,aformat=channel_layouts=stereo",
        ].join(";"),
        out,
      ]),
  },
  impact: {
    name: "Impact (explosion)",
    make: (out: string) =>
      runFfmpeg(["-y", "-v", "error", ...lavfi(`aevalsrc='${IMPACT_EXPR}':s=48000:d=5,lowpass=f=3200,lowpass=f=3200,alimiter=limit=0.9`), "-ac", "2", out]),
  },
  beat: {
    name: "Beat (kick, hi-hat and chord)",
    make: (out: string) => runFfmpeg(["-y", "-v", "error", ...lavfi(`aevalsrc='${BEAT_EXPR}':s=48000:d=8`), "-ac", "2", out]),
  },
} satisfies Record<string, { name: string; make: (out: string, workDir: string) => Promise<unknown> }>;
type DemoKind = keyof typeof DEMOS;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export async function startStudio({ port, open }: { port: number; open: boolean }) {
  const workDir = path.join(tmpdir(), `audiofx-studio-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  const sources = new Map<string, Source>();
  const demoSources = new Map<DemoKind, Source>();
  const librarySources = new Map<string, Source>();
  let library = scanLibrary();

  /** Normalizes any audio or video to 48 kHz stereo WAV (trimmed for preview). */
  async function addSource(input: string, name: string): Promise<Source> {
    const id = randomUUID().slice(0, 8);
    const file = path.join(workDir, `${id}.wav`);
    await runFfmpeg(["-y", "-v", "error", "-i", input, "-vn", "-t", String(MAX_PREVIEW_SECONDS), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", file]);
    const { duration } = await analyzeFile(file);
    const source = { id, name, file, duration };
    sources.set(id, source);
    return source;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method === "POST" && url.pathname === "/api/sources") {
      const name = decodeURIComponent(String(req.headers["x-filename"] ?? "file"));
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > MAX_UPLOAD_BYTES) return json(res, 413, { error: "The file is larger than 2 GB." });
      const raw = path.join(workDir, `upload-${randomUUID()}${path.extname(name)}`);
      await pipeline(req, createWriteStream(raw));
      try {
        const source = await addSource(raw, name);
        return json(res, 200, { id: source.id, name: source.name, duration: source.duration });
      } finally {
        rmSync(raw, { force: true });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/sources/demo") {
      const kind = (url.searchParams.get("kind") ?? "voice") as DemoKind;
      const demo = DEMOS[kind];
      if (!demo) return json(res, 400, { error: `Unknown demo: ${kind}. Options: ${Object.keys(DEMOS).join(", ")}.` });
      let source = demoSources.get(kind);
      if (!source) {
        mkdirSync(DEMO_CACHE, { recursive: true });
        const cached = path.join(DEMO_CACHE, `${kind}-${DEMO_VERSION}.wav`);
        if (!existsSync(cached)) {
          const partial = `${cached}.${process.pid}.tmp.wav`;
          try {
            await demo.make(partial, workDir);
            renameSync(partial, cached);
          } finally {
            rmSync(partial, { force: true });
          }
        }
        source = await addSource(cached, demo.name);
        demoSources.set(kind, source);
      }
      return json(res, 200, { id: source.id, name: source.name, duration: source.duration });
    }
    if (req.method === "GET" && url.pathname === "/api/library") {
      if (url.searchParams.has("refresh")) library = scanLibrary();
      return json(res, 200, { folders: library.folders, items: library.items });
    }
    if (req.method === "GET" && url.pathname === "/api/elevenlabs") {
      const key = findApiKey();
      return json(res, 200, { configured: !!key, source: key?.source ?? null, hint: key ? null : SETUP_HINT });
    }
    if (req.method === "POST" && url.pathname === "/api/sources/elevenlabs") {
      const body = await readJson<GenerateRequest>(req);
      if (!["sfx", "voice", "music"].includes(body.kind)) return json(res, 400, { error: "kind must be sfx, voice or music." });
      try {
        const gen = await generate({
          kind: body.kind,
          prompt: String(body.prompt ?? ""),
          duration: typeof body.duration === "number" ? body.duration : undefined,
          loop: !!body.loop,
          instrumental: !!body.instrumental,
        });
        // The generation lands in ~/.audiofx/generated: rescan so it appears in the library for reuse.
        library = scanLibrary();
        const item = library.items.find((i) => library.paths.get(i.id) === gen.file);
        const source = await addSource(gen.file, item?.name ?? path.basename(gen.file));
        if (item) librarySources.set(item.id, source);
        return json(res, 200, { id: source.id, name: source.name, duration: source.duration, libraryId: item?.id ?? null });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/sources/library") {
      const id = url.searchParams.get("id") ?? "";
      // Only files the scan listed can be opened: the client never sends paths.
      const file = library.paths.get(id);
      if (!file) return json(res, 404, { error: "That audio is no longer in the library. Refresh the list." });
      let source = librarySources.get(id);
      if (!source) {
        const item = library.items.find((i) => i.id === id)!;
        source = await addSource(file, item.name);
        librarySources.set(id, source);
      }
      return json(res, 200, { id: source.id, name: source.name, duration: source.duration });
    }
    const sourceMatch = url.pathname.match(/^\/api\/sources\/([\w-]+)\.wav$/);
    if (req.method === "GET" && sourceMatch) {
      const source = sources.get(sourceMatch[1]);
      if (!source) return json(res, 404, { error: "Source not found." });
      res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(source.file).size });
      return void createReadStream(source.file).pipe(res);
    }
    if (req.method === "POST" && url.pathname === "/api/render") {
      const body = await readJson<{ sourceId: string; steps: EffectStep[]; tail?: number; seed?: number }>(req);
      const source = sources.get(body.sourceId);
      if (!source) return json(res, 404, { error: "Source not found. Load the file again." });
      try {
        const t = Date.now();
        // Samples arrive as library ids: only files the scan listed are read, never a path from the client.
        const steps = await prepareSteps(body.steps, { resolveLibrary: (id) => library.paths.get(id), libraryOnly: true });
        const wav = await applyToBuffer(source.file, steps, { tail: body.tail, seed: body.seed });
        res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "x-render-ms": String(Date.now() - t) });
        return void res.end(wav);
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }
    return json(res, 404, { error: "Unknown route." });
  }

  function serveStatic(res: ServerResponse, url: URL) {
    if (!existsSync(WEB_DIST)) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      return res.end("The web app is not built: run `pnpm build:web` (or use `pnpm studio`, which builds it).");
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.normalize(path.join(WEB_DIST, rel));
    const target = file.startsWith(WEB_DIST) && existsSync(file) && statSync(file).isFile() ? file : path.join(WEB_DIST, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
    res.end(readFileSync(target));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url).catch((error: Error) => json(res, 500, { error: error.message }));
    } else serveStatic(res, url);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = `http://127.0.0.1:${port}`;
  console.log(`AudioFX Studio at ${address}  (Ctrl+C to stop)`);
  if (open) spawn("cmd", ["/c", "start", "", address], { windowsHide: true, detached: true, stdio: "ignore" }).unref();

  const cleanup = () => {
    rmSync(workDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
