import { Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile } from "../../src/core/compile";
import { getEffect, resolveParams } from "../../src/core/registry";
import type { EffectStep, ParamValue } from "../../src/core/types";
import { ChainDrawer } from "@/components/chain-drawer";
import { StepCard, type SampleOption, type Step } from "@/components/chain";
import { ExportPanel } from "@/components/export-panel";
import { Logo } from "@/components/logo";
import { SoundGrid } from "@/components/sound-grid";
import { SourcePicker, type LibraryItem, type SourceRef } from "@/components/source-picker";
import { Stage, type RenderState } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Player } from "./player";
import { CATEGORY_COLORS, sampleSound, stepsAt, type Slot, type Slots, type Sound } from "./recipes";

interface Source {
  id: string;
  name: string;
  duration: number;
}

const CACHE_SIZE = 16;
const IDLE_COLOR = "#1A73F2";

let keySeq = 0;
const toStep = (s: EffectStep): Step => ({
  key: `k${++keySeq}`,
  effect: s.effect,
  params: resolveParams(getEffect(s.effect), s.params),
  windowed: s.from !== undefined || s.to !== undefined,
  bypassed: false,
  from: s.from ?? 0,
  to: s.to ?? 2,
  fade: s.fade ?? 0.25,
  mix: s.mix ?? 1,
});

/** What goes to the compiler: no UI keys, no bypassed steps, and no window unless one was asked for. */
function fromSteps(steps: Step[]): EffectStep[] {
  return steps.filter((s) => !s.bypassed).map(({ effect, params, windowed, from, to, fade, mix }) => {
    const step: EffectStep = { effect, params };
    if (windowed) Object.assign(step, { from, to, fade });
    if (mix !== undefined && mix < 1) step.mix = mix;
    return step;
  });
}

export function App() {
  const player = useMemo(() => new Player(), []);
  const [, force] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [library, setLibrary] = useState<{ items: LibraryItem[]; folders: string[] } | null>(null);
  const [chain, setChain] = useState<Step[]>([]);
  const [selected, setSelected] = useState<Sound | null>(null);
  const [moment, setMoment] = useState(0);
  const [slots, setSlots] = useState<Slots>({ impact: null, whoosh: null });
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [loading, setLoading] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [revealKeys, setRevealKeys] = useState(false);
  const [dragging, setDragging] = useState(false);
  const visibleSounds = useRef<Sound[]>([]);
  const playAfter = useRef<{ seek: number | null } | null>(null);
  const cache = useRef(new Map<string, { buffer: AudioBuffer; url: string }>());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    player.onChange = () => force((x) => x + 1);
  }, [player]);

  const duration = source?.duration ?? 0;
  // Recorded effects to layer: fetched samples, ElevenLabs sound effects and effects found in your folders.
  const sampleOptions = useMemo<SampleOption[]>(
    () => (library?.items ?? []).filter((i) => i.kind === "sfx").map(({ id, name, folder }) => ({ id, name, folder })),
    [library],
  );
  const samples = useMemo(() => sampleOptions.map(sampleSound), [sampleOptions]);
  // A slot whose sample left the library falls back to the synthesized sound.
  const liveSlots = useMemo<Slots>(() => {
    const live = (id: string | null) => (id && sampleOptions.some((s) => s.id === id) ? id : null);
    return { impact: live(slots.impact), whoosh: live(slots.whoosh) };
  }, [slots, sampleOptions]);
  const chainSteps = useMemo(() => fromSteps(chain), [chain]);
  const heard = useMemo(() => {
    const steps = [...chainSteps, ...(selected ? stepsAt(selected.steps, moment, duration, liveSlots) : [])];
    try {
      if (steps.length) compile(steps);
      return { steps, error: null as string | null };
    } catch (error) {
      return { steps: [] as EffectStep[], error: (error as Error).message };
    }
  }, [chainSteps, selected, moment, duration, liveSlots]);

  // Render (or hit the cache) whenever what you hear changes.
  useEffect(() => {
    if (!source || heard.error) return;
    if (!heard.steps.length) {
      player.dropProcessed();
      setDownloadUrl(null);
      setRender({ status: "idle" });
      return;
    }
    const key = `${source.id}|${JSON.stringify(heard.steps)}`;
    const startPlayback = () => {
      const pending = playAfter.current;
      if (!pending) return;
      playAfter.current = null;
      player.setTrack("processed");
      if (pending.seek !== null) player.seek(pending.seek);
      if (!player.playing) void player.play();
    };
    const hit = cache.current.get(key);
    if (hit) {
      player.setBuffer("processed", hit.buffer);
      setDownloadUrl(hit.url);
      setRender({ status: "ready", ms: 0 });
      startPlayback();
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRender((r) => ({ ...r, status: "rendering" }));
      try {
        const res = await fetch("/api/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: source.id, steps: heard.steps }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const data = await res.arrayBuffer();
        const url = URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
        const buffer = await player.load("processed", data);
        cache.current.set(key, { buffer, url });
        if (cache.current.size > CACHE_SIZE) {
          const [oldKey, old] = cache.current.entries().next().value!;
          URL.revokeObjectURL(old.url);
          cache.current.delete(oldKey);
        }
        setDownloadUrl(url);
        setRender({ status: "ready", ms: Number(res.headers.get("x-render-ms")) });
        startPlayback();
      } catch (error) {
        if ((error as Error).name !== "AbortError") setRender({ status: "error", error: (error as Error).message });
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, heard, player]);

  const loadSource = useCallback(
    async (request: () => Promise<Response>, label: string): Promise<boolean> => {
      setLoading(label);
      try {
        const res = await request();
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const info = (await res.json()) as Source;
        const wav = await fetch(`/api/sources/${info.id}.wav`).then((r) => r.arrayBuffer());
        const wasPlaying = player.playing;
        player.clear();
        await player.load("original", wav);
        setSource(info);
        setMoment(Math.round(Math.min(info.duration * 0.35, 8) * 100) / 100);
        if (wasPlaying) void player.play();
        return true;
      } catch (error) {
        setRender({ status: "error", error: (error as Error).message });
        return false;
      } finally {
        setLoading(null);
      }
    },
    [player],
  );

  const pickSource = useCallback(
    (ref: SourceRef, items = library?.items) => {
      if (ref.type === "library") {
        const item = items?.find((i) => i.id === ref.id);
        return loadSource(() => fetch(`/api/sources/library?id=${ref.id}`, { method: "POST" }), `Opening ${item?.name ?? "audio"}…`);
      }
      if (ref.type === "demo") return loadSource(() => fetch(`/api/sources/demo?kind=${ref.kind}`, { method: "POST" }), "Generating demo…");
      if (ref.type === "generate") {
        const label = { sfx: "sound", voice: "voice", music: "music" }[ref.request.kind];
        return loadSource(
          () => fetch("/api/sources/elevenlabs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ref.request) }),
          `Generating ${label} with ElevenLabs…`,
        ).then((ok) => {
          // The generation is now in ~/.audiofx/generated: show it in the library for reuse.
          if (ok) void refreshLibrary();
          return ok;
        });
      }
      fileInput.current?.click();
      return Promise.resolve(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, loadSource],
  );

  const refreshLibrary = useCallback(async (refresh = false) => {
    const res = await fetch(`/api/library${refresh ? "?refresh=1" : ""}`);
    const data = (await res.json()) as { items: LibraryItem[]; folders: string[] };
    setLibrary(data);
    return data;
  }, []);

  // On open: your first voice; otherwise the demo voice; if TTS is unavailable, music.
  useEffect(() => {
    void (async () => {
      const lib = await refreshLibrary().catch(() => null);
      const voice = lib?.items.find((i) => i.kind === "voice");
      if (voice && (await pickSource({ type: "library", id: voice.id }, lib!.items))) return;
      if (await pickSource({ type: "demo", kind: "voice" })) return;
      await pickSource({ type: "demo", kind: "music" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFile = (file: File) =>
    loadSource(
      () => fetch("/api/sources", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file }),
      `Loading ${file.name}…`,
    );

  const showToast = (text: string) => setToast({ id: Date.now(), text });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /** One tap: it plays. When it depends on the moment, playback starts a little earlier so you hear it land. */
  const selectSound = useCallback(
    (sound: Sound) => {
      if (selected?.id === sound.id) {
        setSelected(null);
        return;
      }
      setSelected(sound);
      playAfter.current = { seek: sound.timed ? Math.max(0, moment - 2.5) : player.playing ? null : player.time >= duration - 0.2 ? 0 : null };
    },
    [selected, moment, player, duration],
  );

  const addSound = (sound: Sound) => {
    try {
      const steps = stepsAt(sound.steps, moment, duration, liveSlots).map(toStep);
      setChain((list) => [...list, ...steps]);
      if (selected?.id === sound.id) setSelected(null);
      playAfter.current = { seek: sound.timed ? Math.max(0, moment - 2.5) : null };
      showToast(`${sound.name} added to your chain`);
    } catch (error) {
      showToast((error as Error).message);
    }
  };

  /** Commits the sound being previewed (so it stays before the limiter) and adds a safety limiter last. */
  const addLimiter = () => {
    const previewed = selected ? stepsAt(selected.steps, moment, duration, liveSlots).map(toStep) : [];
    setChain((list) => [...list, ...previewed, toStep({ effect: "limiter" })]);
    setSelected(null);
    showToast(selected ? `${selected.name} and a limiter added to your chain` : "Limiter added at the end of your chain");
  };

  const getLevel = useCallback(() => player.level(), [player]);
  const setHoldOriginal = useCallback((on: boolean) => player.setTrack(on ? "original" : "processed"), [player]);

  // Shortcuts: space, A (hold), M, 1–9, Esc, and Shift to reveal them.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setRevealKeys(true);
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if ((e.key === "a" || e.key === "A") && !e.repeat) setHoldOriginal(true);
      else if (e.key === "m" || e.key === "M") player.setMatchLoudness(!player.matchLoudness);
      else if (e.key === "Escape") setSelected(null);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Nudge the moment like a playhead: 0.1 s, or a full second with Shift.
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
        setMoment((m) => Math.round(Math.max(0, Math.min(duration, m + step)) * 100) / 100);
      }
      else if (/^Digit[1-9]$/.test(e.code)) {
        const sound = visibleSounds.current[Number(e.code.slice(5)) - 1];
        if (sound) selectSound(sound);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setRevealKeys(false);
      if (e.key === "a" || e.key === "A") setHoldOriginal(false);
    };
    const blur = () => {
      setRevealKeys(false);
      setHoldOriginal(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [player, selectSound, setHoldOriginal, duration]);

  const edit = (key: string, patch: Partial<Step>) => setChain((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const setParam = (key: string, id: string, value: ParamValue) =>
    setChain((list) => list.map((s) => (s.key === key ? { ...s, params: { ...s.params, [id]: value } } : s)));
  const move = (index: number, delta: number) =>
    setChain((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
      return next;
    });

  const regions = heard.steps
    .filter((s) => s.from !== undefined || s.to !== undefined)
    .map((s) => ({ from: s.from ?? 0, to: s.to ?? duration, label: getEffect(s.effect).name }));
  const chainNames = chain.map((s) => getEffect(s.effect).name);
  const lastChainColor = chain.length ? CATEGORY_COLORS[getEffect(chain[chain.length - 1].effect).category] : null;
  const timed = (selected?.timed ?? false) || chain.some((s) => getEffect(s.effect).timed);

  return (
    <div
      className="min-h-dvh"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void uploadFile(file);
      }}
    >
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-8">
        <Logo playing={player.playing} getLevel={() => player.level()} />
        <span className="font-display text-[17px] tracking-[-0.02em]">
          AudioFX <span className="text-muted-foreground">Studio</span>
        </span>
        <span className={`ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground transition-opacity duration-200 lg:flex ${revealKeys ? "opacity-100" : "opacity-60"}`}>
          {revealKeys ? (
            <>
              <Kbd>1–9</Kbd> try <Kbd>←→</Kbd> moment <Kbd>Space</Kbd> play <Kbd>A</Kbd> original <Kbd>M</Kbd> match <Kbd>Esc</Kbd> clear
            </>
          ) : (
            <>
              Hold <Kbd>Shift</Kbd> for shortcuts
            </>
          )}
        </span>
        <Button variant="primary" className="max-lg:ml-auto" onClick={() => fileInput.current?.click()}>
          <Upload strokeWidth={1.5} />
          <span className="max-sm:hidden">Upload audio or video</span>
          <span className="sm:hidden">Upload</span>
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
            e.target.value = "";
          }}
        />
      </header>

      <div className="mx-auto max-w-[1320px] px-4 py-6 lg:grid lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Stage
            player={player}
            color={selected?.color ?? lastChainColor ?? IDLE_COLOR}
            listening={selected?.name ?? (chain.length ? "Your chain" : "No effects")}
            listeningHint={selected ? selected.hint : chain.length ? chainNames.join(" → ") : "Pick a sound to try it"}
            sourcePicker={
              <SourcePicker
                current={source}
                loading={loading}
                library={library}
                onPick={(ref) => void pickSource(ref)}
                onUpload={() => fileInput.current?.click()}
                onRefresh={() => void refreshLibrary(true)}
              />
            }
            moment={moment}
            onMoment={setMoment}
            timed={timed}
            render={heard.error ? { status: "error", error: heard.error } : render}
            regions={regions}
            downloadUrl={render.status === "ready" ? downloadUrl : null}
            onHoldOriginal={setHoldOriginal}
            onAddLimiter={addLimiter}
          />
        </div>

        <div className="min-w-0 space-y-8 max-lg:mt-8">
          <SoundGrid
            selected={selected?.id ?? null}
            busy={render.status === "rendering"}
            revealKeys={revealKeys}
            getLevel={getLevel}
            samples={samples}
            sampleOptions={sampleOptions}
            slots={liveSlots}
            onSlot={(slot: Slot, id) => setSlots((s) => ({ ...s, [slot]: id }))}
            onSelect={selectSound}
            onAdd={addSound}
            onVisible={(s) => {
              visibleSounds.current = s;
            }}
          />

          <ChainDrawer
            count={chain.length}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((o) => !o)}
            summary={chain.length ? chainNames.join(" → ") : "Add sounds with + to combine, tweak and export them."}
          >
            {chain.map((step, index) => (
              <StepCard
                key={step.key}
                step={step}
                index={index}
                total={chain.length}
                duration={duration || 10}
                moment={moment}
                samples={sampleOptions}
                onParam={(id, v) => setParam(step.key, id, v)}
                onUpdate={(patch) => edit(step.key, patch)}
                onMove={(d) => move(index, d)}
                onReset={() => edit(step.key, { params: resolveParams(getEffect(step.effect)) })}
                onRemove={() => setChain((list) => list.filter((s) => s.key !== step.key))}
              />
            ))}
            <ExportPanel steps={heard.steps} error={heard.error} />
          </ChainDrawer>
          <div className="pb-10" />
        </div>
      </div>

      {toast && (
        <div key={toast.id} role="status" className="toast fixed bottom-6 left-1/2 z-50 rounded-full bg-foreground px-4 py-2.5 text-[13px] text-white shadow-float">
          {toast.text}
        </div>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-3xl border-2 border-dashed border-foreground/30 bg-background/90 font-display text-2xl font-light tracking-[-0.02em]">
          Drop an audio or video file to use it as the source
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{children}</kbd>;
}
