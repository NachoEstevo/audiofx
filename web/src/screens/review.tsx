import { Check, Crosshair, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile } from "../../../src/core/compile";
import { getEffect, resolveParams } from "../../../src/core/registry";
import { CATEGORY_LABELS, type Params, type ParamValue } from "../../../src/core/types";
import { ParamControl } from "@/components/chain";
import { Measurements, type Facts } from "@/components/measurements";
import { ReviewList, ReviewPicker, VERDICT_UI } from "@/components/review-list";
import { SourcePicker } from "@/components/source-picker";
import { Stage, type RenderState } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { CATEGORY_ICONS } from "@/icons";
import { cn } from "@/lib/utils";
import { onsetSeconds } from "../measure";
import { Player } from "../player";
import { CATEGORY_COLORS, SOUNDS, stepsAt } from "../recipes";
import {
  changedParams,
  editableSpecs,
  fetchReview,
  groupByCategory,
  initialParams,
  matchesQuery,
  MAX_NOTE_LENGTH,
  passesFilter,
  REVIEWABLE,
  saveEntry,
  sameParams,
  unreviewedAfter,
  VERDICTS,
  type Draft,
  type Entries,
  type Filter,
  type Verdict,
} from "../review-store";
import { HeaderSlot, Kbd, ShortcutHint, useScreen, type ScreenProps } from "../shell";
import { initialMoment, useSource } from "../source";
import { formatTime } from "../visuals";

const CACHE_SIZE = 24;
const NO_REGIONS: { from: number; to: number }[] = [];

type SaveState = { status: "idle" | "saving" | "saved" | "error"; text?: string };

/**
 * Walk the catalog by ear on your own audio and mark each effect keep, tweak or cut. The screen shows only
 * what it measures; the verdict is the listener's. Verdicts go to ~/.audiofx/review.json.
 */
export function ReviewScreen({ active }: ScreenProps) {
  const player = useMemo(() => new Player(), []);
  const [, force] = useState(0);
  const [moment, setMoment] = useState(0);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [rendered, setRendered] = useState<{ key: string; ms: number; cached: boolean } | null>(null);
  const [entries, setEntries] = useState<Entries>({});
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState(REVIEWABLE[0].id);
  // What he is trying, per effect, for this session: params and note drafts.
  const [trials, setTrials] = useState<Record<string, Params>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [revealKeys, setRevealKeys] = useState(false);
  const cache = useRef(new Map<string, { buffer: AudioBuffer; ms: number }>());
  const playAfter = useRef<{ seek: number | null } | null>(null);
  const heardRef = useRef<string | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const { source, library, loading, pickSource, refreshLibrary, uploadFile } = useSource(player, {
    loaded: (info) => setMoment(initialMoment(info.duration)),
    failed: (error) => setRender({ status: "error", error }),
    pickFile: () => pickFile(),
  });
  const { pickFile } = useScreen(active, player, uploadFile);

  useEffect(() => {
    player.onChange = () => force((x) => x + 1);
  }, [player]);

  // Verdicts so far; the walk starts on the first effect without one.
  useEffect(() => {
    fetchReview()
      .then((review) => {
        setEntries(review.entries);
        if (review.problem) setProblem(`${review.problem} It will be kept as a separate file when you save your next verdict.`);
        const first = REVIEWABLE.find((e) => !review.entries[e.id]);
        if (first) setCurrentId(first.id);
      })
      .catch((error: Error) => setProblem(`Your review could not be loaded: ${error.message}`))
      .finally(() => setLoaded(true));
  }, []);

  const effect = getEffect(currentId);
  const entry = entries[currentId];
  const duration = source?.duration ?? 0;
  const specs = useMemo(() => editableSpecs(effect), [effect]);
  const params = useMemo(() => trials[currentId] ?? initialParams(effect, entry), [trials, currentId, effect, entry]);
  const changed = useMemo(() => changedParams(specs, params), [specs, params]);
  const steps = useMemo(() => {
    // The catalog tile of this effect: a timed one lands on the marked moment, exactly as on the Sounds screen.
    const recipe = SOUNDS.find((s) => s.id === `e-${effect.id}`)!.steps[0];
    return stepsAt([{ ...recipe, params: changed }], moment, duration);
  }, [effect, changed, moment, duration]);
  const key = source ? `${source.id}|${JSON.stringify(steps)}` : null;

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => REVIEWABLE.filter((e) => matchesQuery(e, q) && passesFilter(e, entries, filter)), [q, entries, filter]);
  const groups = useMemo(() => groupByCategory(visible), [visible]);
  const reviewedCount = REVIEWABLE.filter((e) => entries[e.id]).length;
  const counts = useMemo(() => {
    const of = (v: Verdict) => REVIEWABLE.filter((e) => entries[e.id]?.verdict === v).length;
    const done = REVIEWABLE.filter((e) => entries[e.id]).length;
    return { all: REVIEWABLE.length, todo: REVIEWABLE.length - done, keep: of("keep"), tweak: of("tweak"), cut: of("cut") } satisfies Record<Filter, number>;
  }, [entries]);

  // Render (or hit the cache) whenever what you hear changes.
  useEffect(() => {
    if (!source || !key || !loaded) return;
    const heard = `${source.id}|${effect.id}`;
    const switched = heardRef.current !== heard;
    heardRef.current = heard;
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
      setRendered({ key, ms: hit.ms, cached: true });
      setRender({ status: "ready", ms: hit.ms });
      startPlayback();
      return;
    }
    // Another effect: the previous render must never play under the new name. Silence until it is ready.
    if (switched) {
      if (player.playing) {
        playAfter.current ??= { seek: null };
        player.pause();
      }
      player.dropProcessed();
      setRendered(null);
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRender((r) => ({ ...r, status: "rendering" }));
      try {
        const res = await fetch("/api/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: source.id, steps }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const ms = Number(res.headers.get("x-render-ms"));
        const buffer = await player.ctx.decodeAudioData(await res.arrayBuffer());
        cache.current.set(key, { buffer, ms });
        if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
        if (controller.signal.aborted) return;
        player.setBuffer("processed", buffer);
        setRendered({ key, ms, cached: false });
        setRender({ status: "ready", ms });
        startPlayback();
      } catch (error) {
        if ((error as Error).name !== "AbortError") setRender({ status: "error", error: (error as Error).message });
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `steps` is part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key, loaded, effect.id, player]);

  const goTo = useCallback(
    (id: string) => {
      if (id === currentId) return;
      // While playing, the next effect plays too; one that lands on the moment starts a little before it.
      if (player.playing) playAfter.current = { seek: getEffect(id).timed ? Math.max(0, moment - 2.5) : null };
      setCurrentId(id);
    },
    [currentId, player, moment],
  );

  const move = (delta: number) => {
    if (!visible.length) return;
    const at = visible.findIndex((e) => e.id === currentId);
    const next = at < 0 ? (delta > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, at + delta));
    goTo(visible[next].id);
  };

  /** Optimistic: the list updates now; writes go out in order and a rejection reloads what the file holds. */
  const write = (id: string, draft: Draft | null, done: string) => {
    setEntries((all) => {
      const next = { ...all };
      if (draft) next[id] = { ...draft, reviewed: new Date().toISOString() };
      else delete next[id];
      return next;
    });
    setSave({ status: "saving", text: "Saving…" });
    const name = getEffect(id).name;
    writes.current = writes.current
      .then(() => saveEntry(id, draft))
      .then(
        ({ keptAside }) => {
          if (keptAside) setProblem(null);
          setSave({ status: "saved", text: keptAside ? `${done} The unreadable review was kept as ${keptAside}.` : done });
        },
        async (error: Error) => {
          setSave({ status: "error", text: `${name} not saved: ${error.message}` });
          const fresh = await fetchReview().catch(() => null);
          if (fresh) setEntries(fresh.entries);
        },
      );
  };

  const mark = (verdict: Verdict) => {
    if (!loaded) return;
    const id = currentId;
    const saved = entries[id];
    const note = (notes[id] ?? saved?.note ?? "").trim().slice(0, MAX_NOTE_LENGTH);
    const tweak = verdict === "tweak" && Object.keys(changed).length ? changed : undefined;
    // The same verdict again clears it; a tweak with new params saves them instead.
    if (saved?.verdict === verdict && (verdict !== "tweak" || sameParams(saved.params, tweak))) {
      setNotes((n) => ({ ...n, [id]: note }));
      write(id, null, `${effect.name}: verdict cleared.`);
      return;
    }
    const draft: Draft = { verdict };
    if (note) draft.note = note;
    if (tweak) draft.params = tweak;
    if (source) draft.source = source.name;
    write(id, draft, `${effect.name}: ${VERDICT_UI[verdict].label.toLowerCase()} saved.`);
    // On to the next effect without a verdict: in the list as shown if there is one, else anywhere.
    const remaining = unreviewedAfter(id, { ...entries, [id]: { ...draft, reviewed: "" } });
    const shown = remaining.find((r) => visible.some((e) => e.id === r));
    if (shown) return goTo(shown);
    if (remaining.length) {
      setFilter("all");
      setQuery("");
      goTo(remaining[0]);
    }
  };

  const saveNote = () => {
    const id = currentId;
    const saved = entries[id];
    const draft = notes[id];
    if (!saved || draft === undefined || draft.trim() === (saved.note ?? "")) return;
    const { reviewed: _reviewed, ...rest } = saved;
    write(id, { ...rest, note: draft.trim() || undefined }, `${effect.name}: note saved.`);
  };

  const setParam = (id: string, value: ParamValue) => setTrials((t) => ({ ...t, [currentId]: { ...params, [id]: value } }));
  const setHoldOriginal = useCallback((on: boolean) => player.setTrack(on ? "original" : "processed"), [player]);

  // Shortcuts, only while this screen is shown. The handlers read the latest state through a ref.
  const keys = useRef({ mark, move, duration });
  keys.current = { mark, move, duration };
  useEffect(() => {
    if (!active) {
      setRevealKeys(false);
      return;
    }
    // Sliders keep the letter keys working (try a value, press T) but own their arrow keys.
    const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest("textarea, select, [contenteditable], input:not([type=range])");
    const onSlider = (e: KeyboardEvent) => e.target instanceof HTMLInputElement && e.target.type === "range";
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setRevealKeys(true);
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (k === "a" && !e.repeat) setHoldOriginal(true);
      else if (k === "m") player.setMatchLoudness(!player.matchLoudness);
      else if (k === "k" && !e.repeat) keys.current.mark("keep");
      else if (k === "t" && !e.repeat) keys.current.mark("tweak");
      else if (k === "x" && !e.repeat) keys.current.mark("cut");
      else if (onSlider(e)) return;
      else if (e.key === "ArrowDown" || k === "l") {
        e.preventDefault();
        keys.current.move(1);
      } else if (e.key === "ArrowUp" || k === "j") {
        e.preventDefault();
        keys.current.move(-1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Nudge the moment like a playhead: 0.1 s, or a full second with Shift.
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
        setMoment((m) => Math.round(Math.max(0, Math.min(keys.current.duration, m + step)) * 100) / 100);
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
  }, [active, player, setHoldOriginal]);

  // Measurements of the render you are hearing (dimmed while the next one renders).
  const original = player.peek("original");
  const processed = player.peek("processed");
  const originalOnset = useMemo(() => (original ? onsetSeconds(original) : 0), [original]);
  const processedOnset = useMemo(() => (processed ? onsetSeconds(processed) : 0), [processed]);
  const peak = player.peak("processed");
  const levelDb = player.levelDiffDb;
  const tailPad = useMemo(() => {
    try {
      return compile(steps).tail;
    } catch {
      return 0;
    }
  }, [steps]);
  const facts: Facts | null =
    original && processed && peak && levelDb !== null && rendered
      ? {
          levelDb,
          peakDb: peak.db,
          clips: player.clipping,
          clipped: peak.clipped,
          durationChange: processed.duration - original.duration,
          tailPad,
          renderMs: rendered.ms,
          cached: rendered.cached,
          onsetShift: effect.timed || effect.changesDuration ? null : processedOnset - originalOnset,
          onsetSkipped: effect.timed ? "Not measured: it lands on the moment" : effect.changesDuration ? "Not measured: it changes the duration" : null,
        }
      : null;
  const stale = render.status === "rendering" || rendered?.key !== key;

  const Icon = CATEGORY_ICONS[effect.category];
  const position = REVIEWABLE.findIndex((e) => e.id === effect.id) + 1;
  const note = notes[currentId] ?? entry?.note ?? "";
  const hasChanges = Object.keys(changed).length > 0;
  const listProps = {
    groups,
    entries,
    current: currentId,
    reviewed: reviewedCount,
    counts,
    filter,
    onFilter: setFilter,
    problem,
    onPick: goTo,
  };

  return (
    <>
      <HeaderSlot active={active}>
        <ShortcutHint revealed={revealKeys}>
          <Kbd>K</Kbd> keep <Kbd>T</Kbd> tweak <Kbd>X</Kbd> cut <Kbd>↑↓</Kbd> move <Kbd>Space</Kbd> play <Kbd>A</Kbd> original <Kbd>M</Kbd> match
        </ShortcutHint>
      </HeaderSlot>

      <div className="mx-auto max-w-[1320px] px-4 py-6 max-lg:pb-32 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <ReviewList {...listProps} query={query} onQuery={setQuery} className="max-lg:hidden lg:sticky lg:top-24 lg:self-start" />
        <ReviewPicker {...listProps} onMove={move} className="lg:hidden" />

        <div className="min-w-0 max-lg:mt-6 xl:grid xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:gap-8">
          <div className="xl:sticky xl:top-24 xl:self-start">
            <Stage
              player={player}
              color={CATEGORY_COLORS[effect.category]}
              listening={effect.name}
              listeningHint={`${CATEGORY_LABELS[effect.category]} · ${effect.id}`}
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
              timed={!!effect.timed}
              render={render}
              regions={NO_REGIONS}
              downloadUrl={null}
              onHoldOriginal={setHoldOriginal}
              meter={false}
            />
          </div>

          <div className="min-w-0 space-y-4 max-xl:mt-4">
            <section aria-label={`About ${effect.name}`} className="rounded-3xl bg-card p-5 shadow-ring">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {CATEGORY_LABELS[effect.category]}
                </span>
                <span className="ml-auto font-mono tabular-nums">
                  {position} / {REVIEWABLE.length}
                </span>
              </p>
              <p className="mt-2 font-display text-[19px] leading-snug tracking-[-0.02em] text-pretty">{effect.description}</p>
              <p className="mt-3 text-[13px] leading-snug text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">When to use. </span>
                {effect.whenToUse}
              </p>
              {(effect.timed || effect.changesDuration) && (
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {effect.timed && (
                    <span className="inline-flex items-center gap-1.5">
                      <Crosshair className="size-3.5 text-[var(--moment)]" strokeWidth={1.5} aria-hidden />
                      Lands on the moment marked on the waveform, now {formatTime(moment)}
                    </span>
                  )}
                  {effect.changesDuration && <span className="text-muted-foreground">Changes the duration of the audio</span>}
                </p>
              )}
            </section>

            <section aria-labelledby="review-verdict" className="rounded-3xl bg-card p-5 shadow-ring">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id="review-verdict" className="font-display text-lg tracking-[-0.02em]">
                  Your verdict
                </h3>
                <SaveStatus save={save} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 max-lg:hidden">
                <VerdictButtons current={entry?.verdict} onMark={mark} />
              </div>
              {entry?.verdict === "tweak" && (
                <p className="mt-3 text-[13px] text-pretty text-muted-foreground">
                  {entry.params ? `Saved with ${describeParams(effect.id, entry.params)}.` : "Saved without param changes."}
                  {!sameParams(entry.params, hasChanges ? changed : undefined) && " Your params changed since: Tweak saves them again."}
                </p>
              )}
              {entry?.verdict !== "tweak" && hasChanges && (
                <p className="mt-3 text-[13px] text-pretty text-muted-foreground">You are hearing changed params: Tweak saves them, Keep and Cut do not.</p>
              )}
              <label className="mt-4 block">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                  <span>Note</span>
                  <span className="text-xs text-muted-foreground">{entry ? "Saves when you leave the box" : "Saved with your verdict"}</span>
                </span>
                <textarea
                  value={note}
                  maxLength={MAX_NOTE_LENGTH}
                  onChange={(e) => setNotes((n) => ({ ...n, [currentId]: e.target.value }))}
                  onBlur={saveNote}
                  rows={3}
                  placeholder="What to retune, or why it goes"
                  className="mt-1.5 block w-full resize-y rounded-2xl bg-muted px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
                />
              </label>
            </section>

            <Measurements facts={facts} stale={stale} />

            <section aria-labelledby="review-params" className="rounded-3xl bg-card p-5 shadow-ring">
              <div className="flex items-center justify-between gap-3">
                <h3 id="review-params" className="font-display text-lg tracking-[-0.02em]">
                  Params
                </h3>
                <Button size="sm" variant="ghost" onClick={() => setTrials((t) => ({ ...t, [currentId]: resolveParams(effect) }))} disabled={!hasChanges}>
                  <RotateCcw strokeWidth={1.5} /> Defaults
                </Button>
              </div>
              <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
                Try other values; Tweak saves the ones you changed.{effect.timed && " The moment comes from the waveform."}
              </p>
              {specs.length ? (
                <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {specs.map((spec) => (
                    <ParamControl key={spec.id} spec={spec} value={params[spec.id] ?? spec.default} moment={moment} samples={[]} onChange={(v) => setParam(spec.id, v)} />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-muted-foreground">This effect has no params.</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* On a phone the verdicts stay under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          <VerdictButtons current={entry?.verdict} onMark={mark} tall />
        </div>
      </div>
    </>
  );
}

function VerdictButtons({ current, onMark, tall }: { current?: Verdict; onMark: (v: Verdict) => void; tall?: boolean }) {
  return VERDICTS.map((verdict) => {
    const { label, key, icon: Icon } = VERDICT_UI[verdict];
    const on = current === verdict;
    return (
      <button
        key={verdict}
        type="button"
        aria-pressed={on}
        onClick={() => onMark(verdict)}
        title={on ? `${label} (${key}): press again to clear` : `${label} (${key})`}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full text-sm whitespace-nowrap transition-colors select-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          tall ? "h-12" : "h-11",
          on ? "bg-foreground text-white" : "bg-muted text-foreground hover:bg-muted-strong",
        )}
      >
        <Icon className="size-4" strokeWidth={on ? 2 : 1.5} aria-hidden />
        {label}
        <kbd className={cn("font-mono text-[11px] max-lg:hidden", on ? "text-white/60" : "text-muted-foreground")}>{key}</kbd>
      </button>
    );
  });
}

function SaveStatus({ save }: { save: SaveState }) {
  return (
    <p aria-live="polite" className={cn("flex min-w-0 items-start gap-1 text-xs text-pretty", save.status === "error" ? "text-danger" : "text-muted-foreground")}>
      {save.status === "error" && <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />}
      {save.status === "saved" && <Check className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />}
      {save.text}
    </p>
  );
}

/** "Cutoff 1.2k Hz, Slope 24": saved params with their labels and units. */
function describeParams(effectId: string, params: Record<string, ParamValue>) {
  const effect = getEffect(effectId);
  return Object.entries(params)
    .map(([id, v]) => {
      const spec = effect.params.find((p) => p.id === id);
      const unit = spec?.type === "number" && spec.unit ? ` ${spec.unit}` : "";
      return `${spec?.label ?? id} ${typeof v === "number" ? Number(v.toFixed(2)) : String(v)}${unit}`;
    })
    .join(", ");
}
