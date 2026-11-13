import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CATEGORY_LABELS,
  analyzeFile,
  applyToFile,
  catalog,
  compile,
  getEffect,
  parseStep,
  resolveFfmpeg,
  runFfmpeg,
  type Category,
  type EffectInfo,
  type EffectStep,
} from "./core/index.js";
import { catalogMarkdown } from "./catalog-markdown.js";
import { findApiKey, generate, SETUP_HINT, type GenerateKind } from "./elevenlabs.js";

const HELP = `sfx — sound design effects for video (ffmpeg filtergraphs)

Usage:
  sfx list [--category <cat>] [--json]          Effect catalog
  sfx describe <effect> [--json]                Params, ranges and when to use it
  sfx graph <step...> [--json]                  Prints the filtergraph for ffmpeg -af
  sfx apply <input> <output> <step...>          Processes a file (audio or video)
  sfx generate <sfx|voice|music> "<prompt>" <output> [step...]
                                                Generates with ElevenLabs, then applies the steps
  sfx analyze <file> [--json]                   Loudness (LUFS), true peak, peak, RMS, duration
  sfx studio [--port 5177] [--no-open]          Opens the web studio to listen and tweak
  sfx catalog                                   Catalog as Markdown (for the skill)
  sfx doctor                                    Checks ffmpeg, the filters it needs and the ElevenLabs key

Step format:  effect[:param=value,param=value][@from-to]
  underwater:depth=0.8@3.2-7      underwater between 3.2 s and 7 s
  reverb:space=cathedral,mix=0.4  reverb on the whole audio
  hit:at=6                        a trailer hit at 6 s
  am-radio                        default params

apply and graph options:
  --chain <file.json>      Saved chain: [{ "effect": "...", "params": {...}, "from": 1, "to": 2 }]
  --fade <s>               Crossfade at window edges (default 0.25)
  --mix <0-1>              Processed proportion of the steps
  --tail <s>               Silence added for reverb/echo tails (default 3 when needed, 0 otherwise)
  --seed <n>               Seed for noises and IRs (default 1234)
  --start <s> --duration <s>   Trims the input before processing (apply only)

generate options (needs ELEVENLABS_API_KEY; generations are also kept in ~/.audiofx/generated):
  --duration <s>           sfx: 0.5–30 s (default: the model decides) · music: 3–600 s
  --loop                   sfx: seamless loop for ambiences and beds
  --influence <0-1>        sfx: how literally to follow the prompt (default 0.3)
  --voice <id>             voice: voice id (default George, a premade voice)
  --model <id>             Model override (defaults: eleven_text_to_sound_v3, eleven_v4)
  --instrumental           music: no vocals

If the output is a video (.mp4, .mov, .mkv, .webm), the picture is copied without re-encoding and the audio is replaced.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    category: { type: "string" },
    chain: { type: "string" },
    fade: { type: "string" },
    mix: { type: "string" },
    tail: { type: "string" },
    seed: { type: "string" },
    start: { type: "string" },
    duration: { type: "string" },
    loop: { type: "boolean" },
    influence: { type: "string" },
    voice: { type: "string" },
    model: { type: "string" },
    instrumental: { type: "boolean" },
    port: { type: "string" },
    "no-open": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const num = (v: string | undefined, name: string) => {
  if (v === undefined) return undefined;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`--${name} must be a number.`);
  return x;
};

function stepsFrom(specs: string[], required = true): EffectStep[] {
  const steps: EffectStep[] = [];
  if (values.chain) {
    const data = JSON.parse(readFileSync(values.chain, "utf8"));
    const list = Array.isArray(data) ? data : data.steps;
    if (!Array.isArray(list)) throw new Error(`${values.chain} must contain an array of steps or { "steps": [...] }.`);
    steps.push(...list);
  }
  steps.push(...specs.map(parseStep));
  if (required && !steps.length) throw new Error("Give at least one effect (e.g. `underwater` or `reverb:space=hall`).");
  const fade = num(values.fade, "fade");
  const mix = num(values.mix, "mix");
  return steps.map((s) => ({ ...s, fade: s.fade ?? fade, mix: s.mix ?? mix }));
}

function compileOptions() {
  return { tail: num(values.tail, "tail"), seed: num(values.seed, "seed") };
}

function formatParam(p: EffectInfo["params"][number]): string {
  if (p.type === "number") return `${p.id}=${p.default}  (${p.min}–${p.max}${p.unit ? " " + p.unit : ""})  ${p.label}`;
  if (p.type === "enum") return `${p.id}=${p.default}  (${p.options.join(" | ")})  ${p.label}`;
  return `${p.id}=${p.default}  (true | false)  ${p.label}`;
}

async function report(output: string, started: number, extra: Record<string, unknown> = {}) {
  const analysis = await analyzeFile(output);
  const result = { output, ...extra, analysis, ms: Date.now() - started };
  if (values.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`✔ ${output}  (${analysis.duration.toFixed(2)} s, ${analysis.integratedLufs ?? "?"} LUFS, peak ${analysis.peakDb?.toFixed(1) ?? "?"} dBFS, ${result.ms} ms)`);
  if ((analysis.peakDb ?? -99) > -0.1) console.log("⚠ The output reaches 0 dBFS: add `limiter` or `loudness` at the end of the chain.");
}

async function main() {
  const [command, ...args] = positionals;
  if (!command || values.help) return void process.stdout.write(HELP);

  switch (command) {
    case "list": {
      const items = catalog().filter((e) => !values.category || e.category === values.category);
      if (values.json) return console.log(JSON.stringify(items, null, 2));
      for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
        const group = items.filter((e) => e.category === (cat as Category));
        if (!group.length) continue;
        console.log(`\n${label} (${cat})`);
        for (const e of group) console.log(`  ${e.id.padEnd(16)} ${e.description}`);
      }
      return;
    }
    case "describe": {
      if (!args[0]) throw new Error("Usage: sfx describe <effect>");
      const e = catalog().find((x) => x.id === getEffect(args[0]).id)!;
      if (values.json) return console.log(JSON.stringify(e, null, 2));
      console.log(`${e.name} (${e.id}) — ${CATEGORY_LABELS[e.category]}\n`);
      console.log(e.description);
      console.log(`\nWhen to use it: ${e.whenToUse}`);
      console.log(`Tags: ${e.tags.join(", ")}`);
      if (e.timed) console.log("Happens at a moment: anchor it with at=<seconds>.");
      if (e.changesDuration) console.log("Changes the duration: no from/to/mix.");
      if (e.hasTail) console.log("Adds a tail: 3 s of silence are added at the end by default (--tail).");
      console.log(`\nParams:${e.params.length ? "" : " none"}`);
      for (const p of e.params) console.log(`  ${formatParam(p)}${p.description ? ` — ${p.description}` : ""}`);
      return;
    }
    case "graph": {
      const compiled = compile(stepsFrom(args), compileOptions());
      if (values.json) return console.log(JSON.stringify(compiled, null, 2));
      return console.log(compiled.graph);
    }
    case "apply": {
      const [input, output, ...specs] = args;
      if (!input || !output) throw new Error("Usage: sfx apply <input> <output> <step...>");
      const t = Date.now();
      const compiled = await applyToFile(input, output, stepsFrom(specs), {
        ...compileOptions(),
        start: num(values.start, "start"),
        duration: num(values.duration, "duration"),
      });
      return report(output, t, { steps: compiled.steps, tail: compiled.tail });
    }
    case "generate": {
      const [kind, prompt, output, ...specs] = args;
      if (!["sfx", "voice", "music"].includes(kind) || !prompt || !output) {
        throw new Error('Usage: sfx generate <sfx|voice|music> "<prompt>" <output> [step...]');
      }
      const steps = stepsFrom(specs, false);
      // Validate the chain before spending credits on a generation.
      if (steps.length) compile(steps, compileOptions());
      const t = Date.now();
      const gen = await generate({
        kind: kind as GenerateKind,
        prompt,
        duration: num(values.duration, "duration"),
        loop: values.loop,
        influence: num(values.influence, "influence"),
        voice: values.voice,
        model: values.model,
        instrumental: values.instrumental,
      });
      if (!values.json) console.log(`ElevenLabs → ${gen.file}`);
      if (steps.length) {
        const compiled = await applyToFile(gen.file, output, steps, compileOptions());
        return report(output, t, { generated: gen.file, steps: compiled.steps, tail: compiled.tail });
      }
      if (path.extname(output).toLowerCase() === ".mp3") copyFileSync(gen.file, output);
      else await runFfmpeg(["-y", "-v", "error", "-i", gen.file, "-ar", "48000", output]);
      return report(output, t, { generated: gen.file });
    }
    case "analyze": {
      if (!args[0]) throw new Error("Usage: sfx analyze <file>");
      const a = await analyzeFile(args[0]);
      if (values.json) return console.log(JSON.stringify(a, null, 2));
      console.log(`Duration:  ${a.duration.toFixed(2)} s`);
      console.log(`Loudness:  ${a.integratedLufs ?? "?"} LUFS integrated (LRA ${a.loudnessRange ?? "?"} LU)`);
      console.log(`True peak: ${a.truePeakDb ?? "?"} dBTP · peak ${a.peakDb?.toFixed(2) ?? "?"} dBFS · RMS ${a.rmsDb?.toFixed(2) ?? "?"} dBFS`);
      return;
    }
    case "catalog":
      return void process.stdout.write(catalogMarkdown());
    case "doctor": {
      const ffmpeg = resolveFfmpeg();
      const { stdout } = await runFfmpeg(["-filters"]);
      const text = stdout.toString();
      const needed = ["afir", "rubberband", "asendcmd", "acrusher", "asoftclip", "afreqshift", "loudnorm", "chorus", "anoisesrc", "aevalsrc", "aeval"];
      const missing = needed.filter((f) => !new RegExp(`\\s${f}\\s`).test(text));
      const version = (await runFfmpeg(["-version"])).stdout.toString().split("\n")[0];
      console.log(`ffmpeg: ${ffmpeg}\n${version}`);
      console.log(missing.length ? `✘ Missing filters: ${missing.join(", ")}` : `✔ All ${needed.length} filters the catalog uses are available.`);
      const key = findApiKey();
      console.log(key ? `✔ ElevenLabs key found (${key.source}).` : `– ElevenLabs (optional): ${SETUP_HINT}`);
      if (missing.length) process.exitCode = 1;
      return;
    }
    case "studio": {
      const { startStudio } = await import("./server.js");
      await startStudio({ port: num(values.port, "port") ?? 5177, open: !values["no-open"] });
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error: Error) => {
  console.error(`✘ ${error.message}`);
  process.exit(1);
});
