import { KeyRound, LoaderCircle, Mic, Music, RefreshCw, Sparkles, Wand2, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface GenerateRequest {
  kind: "sfx" | "voice" | "music";
  prompt: string;
  duration?: number;
  loop?: boolean;
  instrumental?: boolean;
}

type Status = { configured: boolean; source: string | null; hint: string | null };

const KINDS: { kind: GenerateRequest["kind"]; label: string; icon: LucideIcon; placeholder: string; examples: string[] }[] = [
  {
    kind: "sfx",
    label: "Sound",
    icon: Sparkles,
    placeholder: "Describe the sound: what, where, how it moves",
    examples: ["Heavy wooden door slams in a stone hallway", "Rain on a car roof, steady, no thunder", "Glass shatters on a tiled floor", "Sci-fi UI confirm beep, soft"],
  },
  {
    kind: "voice",
    label: "Voice",
    icon: Mic,
    placeholder: "What should the voice say?",
    examples: ["In a world where every second counts…", "Breaking news: the signal is back.", "Can you hear me? I'm under the bridge."],
  },
  {
    kind: "music",
    label: "Music",
    icon: Music,
    placeholder: "Genre, mood, instruments, tempo",
    examples: ["Tense trailer drums building to a hit, 100 bpm", "Warm lo-fi piano loop, relaxed", "Upbeat synthwave for a product launch"],
  },
];

const DURATIONS: Record<GenerateRequest["kind"], (number | undefined)[]> = {
  sfx: [undefined, 2, 5, 10],
  voice: [],
  music: [15, 30, 60],
};

/**
 * Generates a source with ElevenLabs through the local server (the key never reaches the browser).
 * The result is saved in ~/.audiofx/generated, so it stays in the library to reuse with any effect.
 */
export function GeneratePanel(props: { open: boolean; busy: boolean; initialKind?: GenerateRequest["kind"]; onGenerate: (request: GenerateRequest) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [kind, setKind] = useState<GenerateRequest["kind"]>(props.initialKind ?? "sfx");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number | undefined>(props.initialKind === "music" ? 30 : undefined);
  const [loop, setLoop] = useState(false);
  const [instrumental, setInstrumental] = useState(true);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await fetch("/api/elevenlabs").then((r) => r.json()));
    } catch {
      setStatus({ configured: false, source: null, hint: "The studio server is not reachable." });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (props.open && !status) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const spec = KINDS.find((k) => k.kind === kind)!;
  const pickKind = (k: GenerateRequest["kind"]) => {
    setKind(k);
    setDuration(k === "music" ? 30 : undefined);
  };

  if (!status) {
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="space-y-3 px-2 pt-4 pb-2 text-[13px]">
        <div className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4" strokeWidth={1.5} /> Connect ElevenLabs
        </div>
        <p className="text-muted-foreground">
          Generate sound effects, voices and music, then run them through any effect here. The key stays on your machine: the studio reads it from the
          environment or a <code className="font-mono text-xs">.env</code> file.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Create an API key in{" "}
            <a className="text-foreground underline underline-offset-2" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
              your ElevenLabs settings
            </a>
            .
          </li>
          <li>
            Run <code className="rounded bg-muted px-1 font-mono text-xs">npx -y @elevenlabs/cli@latest onboard init</code> in the project, or add{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">ELEVENLABS_API_KEY=…</code> to <code className="font-mono text-xs">~/.audiofx/.env</code>.
          </li>
          <li>Check again. No restart needed.</li>
        </ol>
        <button
          onClick={() => void check()}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-muted-strong"
        >
          <RefreshCw className={cn("size-3.5", checking && "animate-spin")} strokeWidth={1.5} /> Check again
        </button>
      </div>
    );
  }

  const submit = () => {
    const text = prompt.trim();
    if (!text || props.busy) return;
    props.onGenerate({ kind, prompt: text, duration: kind === "voice" ? undefined : duration, loop: kind === "sfx" && loop, instrumental: kind === "music" && instrumental });
  };

  return (
    <div className="space-y-3 px-1 pt-3 pb-1">
      <div className="flex gap-1.5" role="radiogroup" aria-label="What to generate">
        {KINDS.map(({ kind: k, label, icon: Icon }) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => pickKind(k)}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
              kind === k ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.5} /> {label}
          </button>
        ))}
      </div>
      <textarea
        className="h-20 w-full resize-none rounded-2xl bg-muted px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
        placeholder={spec.placeholder}
        value={prompt}
        maxLength={kind === "voice" ? 2000 : 450}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        aria-label="Prompt"
      />
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {spec.examples.map((ex) => (
          <button key={ex} onClick={() => setPrompt(ex)} className="h-7 shrink-0 cursor-pointer rounded-full bg-card px-2.5 text-xs whitespace-nowrap shadow-ring hover:bg-muted">
            {ex}
          </button>
        ))}
      </div>
      {kind !== "voice" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="mr-1 text-muted-foreground">Length</span>
          {DURATIONS[kind].map((d) => (
            <button
              key={d ?? "auto"}
              onClick={() => setDuration(d)}
              aria-pressed={duration === d}
              className={cn("h-7 cursor-pointer rounded-full px-2.5 text-xs", duration === d ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong")}
            >
              {d === undefined ? "Auto" : `${d} s`}
            </button>
          ))}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs">
            {kind === "sfx" ? (
              <>
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Seamless loop
              </>
            ) : (
              <>
                <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> Instrumental
              </>
            )}
          </label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={`Key found in ${status.source}`}>
          Uses your ElevenLabs credits · saved to ~/.audiofx/generated
        </span>
        <button
          onClick={submit}
          disabled={!prompt.trim() || props.busy}
          className="ml-auto inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] text-white transition-opacity hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.busy ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} /> : <Wand2 className="size-4" strokeWidth={1.5} />} Generate
        </button>
      </div>
    </div>
  );
}
