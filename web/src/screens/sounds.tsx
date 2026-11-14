import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile } from "../../../src/core/compile";
import { getEffect, resolveParams } from "../../../src/core/registry";
import type { EffectStep, ParamValue } from "../../../src/core/types";
import { ChainDrawer } from "@/components/chain-drawer";
import { ParamControl, StepCard, type SampleOption, type Step } from "@/components/chain";
import { ExportPanel } from "@/components/export-panel";
import { SoundGrid } from "@/components/sound-grid";
import { SourcePicker } from "@/components/source-picker";
import { Stage, type RenderState } from "@/components/stage";
import { Player } from "../player";
import { CATEGORY_COLORS, sampleSound, slotOf, stepsAt, type Slot, type Slots, type Sound } from "../recipes";
import { HeaderSlot, Kbd, ShortcutHint, useScreen, type ScreenProps } from "../shell";
import { initialMoment, useSource } from "../source";
import { fromSteps, toStep } from "../steps";

const CACHE_SIZE = 16;
const IDLE_COLOR = "#1A73F2";

/** Try sounds over your audio, chain them, tweak and export. */
export function SoundsScreen({ active }: ScreenProps) {
  const player = useMemo(() => new Player(), []);
  const [, force] = useState(0);
  const [chain, setChain] = useState<Step[]>([]);
  const [selected, setSelected] = useState<Sound | null>(null);
  // Param changes made while trying a sound, by sound id and step: kept for the session, carried into the chain.
  const [tweaks, setTweaks] = useState<Tweaks>({});
  const [moment, setMoment] = useState(0);
  const [slots, setSlots] = useState<Slots>({ impact: null, whoosh: null });
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revealKeys, setRevealKeys] = useState(false);
  const visibleSounds = useRef<Sound[]>([]);
  const playAfter = useRef<{ seek: number | null } | null>(null);
  const cache = useRef(new Map<string, { buffer: AudioBuffer; url: string }>());
  const { source, library, loading, pickSource, refreshLibrary, uploadFile } = useSource(player, {
    loaded: (info) => setMoment(initialMoment(info.duration)),
    failed: (error) => setRender({ status: "error", error }),
    pickFile: () => pickFile(),
  });
  const { toast: showToast, pickFile } = useScreen(active, player, uploadFile);

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
  const tuned = useMemo(() => (selected ? withTweaks(selected, tweaks) : null), [selected, tweaks]);
  const chainSteps = useMemo(() => fromSteps(chain), [chain]);
  const heard = useMemo(() => {
    const steps = [...chainSteps, ...(tuned ? stepsAt(tuned.steps, moment, duration, liveSlots) : [])];
    try {
      if (steps.length) compile(steps);
      return { steps, error: null as string | null };
    } catch (error) {
      return { steps: [] as EffectStep[], error: (error as Error).message };
    }
  }, [chainSteps, tuned, moment, duration, liveSlots]);

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
      const steps = stepsAt(withTweaks(sound, tweaks).steps, moment, duration, liveSlots).map(toStep);
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
    const previewed = tuned ? stepsAt(tuned.steps, moment, duration, liveSlots).map(toStep) : [];
    setChain((list) => [...list, ...previewed, toStep({ effect: "limiter" })]);
    setSelected(null);
    showToast(selected ? `${selected.name} and a limiter added to your chain` : "Limiter added at the end of your chain");
  };

  const getLevel = useCallback(() => player.level(), [player]);
  const setHoldOriginal = useCallback((on: boolean) => player.setTrack(on ? "original" : "processed"), [player]);

  // Shortcuts: space, A (hold), M, 1–9, Esc, and Shift to reveal them. Only while this screen is shown.
  useEffect(() => {
    if (!active) {
      setRevealKeys(false);
      return;
    }
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
  }, [active, player, selectSound, setHoldOriginal, duration]);

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
    <>
      <HeaderSlot active={active}>
        <ShortcutHint revealed={revealKeys}>
          <Kbd>1–9</Kbd> try <Kbd>←→</Kbd> moment <Kbd>Space</Kbd> play <Kbd>A</Kbd> original <Kbd>M</Kbd> match <Kbd>Esc</Kbd> clear
        </ShortcutHint>
      </HeaderSlot>

      <div className="mx-auto max-w-[1320px] px-4 py-6 lg:grid lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Stage
            player={player}
            color={selected?.color ?? lastChainColor ?? IDLE_COLOR}
            listening={selected?.name ?? (chain.length ? "Your chain" : "No effects")}
            listeningHint={selected ? selected.hint : chain.length ? chainNames.join(" → ") : ""}
            sourcePicker={
              <SourcePicker
                current={source}
                loading={loading}
                library={library}
                onPick={(ref) => void pickSource(ref)}
                onUpload={pickFile}
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
          {tuned && (
            <TweakPanel
              sound={tuned}
              slots={liveSlots}
              moment={moment}
              samples={sampleOptions}
              changed={!!tweaks[tuned.id]}
              onParam={(step, id, value) => setTweaks((t) => ({ ...t, [tuned.id]: { ...t[tuned.id], [step]: { ...t[tuned.id]?.[step], [id]: value } } }))}
              onReset={() => setTweaks(({ [tuned.id]: _, ...rest }) => rest)}
            />
          )}
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
    </>
  );
}

type Tweaks = Record<string, Record<number, Record<string, ParamValue>>>;

/** The sound with the params changed while trying it. */
function withTweaks(sound: Sound, tweaks: Tweaks): Sound {
  const mine = tweaks[sound.id];
  return mine ? { ...sound, steps: sound.steps.map((step, i) => (mine[i] ? { ...step, params: { ...step.params, ...mine[i] } } : step)) } : sound;
}

/**
 * The params of the sound being tried, editable in place: every change re-renders it. The moment itself is
 * set on the waveform, and a step replaced by a sample has no params of its own.
 */
function TweakPanel(props: {
  sound: Sound;
  slots: Slots;
  moment: number;
  samples: SampleOption[];
  changed: boolean;
  onParam: (step: number, id: string, value: ParamValue) => void;
  onReset: () => void;
}) {
  const steps = props.sound.steps
    .map((step, index) => ({ step, index, effect: getEffect(step.effect) }))
    .filter(({ step }) => {
      const slot = slotOf(step.effect);
      return !(slot && props.slots[slot]);
    })
    .map((s) => ({ ...s, specs: s.effect.params.filter((spec) => spec.id !== "at" && spec.type !== "file") }))
    .filter((s) => s.specs.length);
  if (!steps.length) return null;
  return (
    <section aria-label={`Tweak ${props.sound.name}`} className="animate-rise mt-4 rounded-[28px] bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[19px] tracking-[-0.02em]">Tweak</h3>
        {props.changed && (
          <button onClick={props.onReset} className="cursor-pointer text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Reset
          </button>
        )}
      </div>
      <div className="mt-4 space-y-6">
        {steps.map(({ step, index, effect, specs }) => {
          const values = resolveParams(effect, step.params);
          return (
            <div key={index}>
              {steps.length > 1 && <p className="mb-3 text-[13px] font-medium">{effect.name}</p>}
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {specs.map((spec) => (
                  <ParamControl key={spec.id} spec={spec} value={values[spec.id]} moment={props.moment} samples={props.samples} onChange={(v) => props.onParam(index, spec.id, v)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
