import { AudioLines, Clapperboard, Crosshair, Info, LoaderCircle, Plus, Redo2, Search, Sparkles, Undo2, Upload, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SampleOption } from "@/components/chain";
import { Inspector } from "@/components/mix/inspector";
import { MenuRow, Popover } from "@/components/mix/popover";
import { Timeline } from "@/components/mix/timeline";
import { ExportMenu, MixMeter, Transport, type ExportKind } from "@/components/mix/transport";
import { PictureEmpty, VideoPreview, type PictureState } from "@/components/mix/video-preview";
import { SourcePicker, type LibraryItem, type SourceRef } from "@/components/source-picker";
import type { RenderState } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  demoAudio,
  download,
  dropVideo,
  ensureProxy,
  exportMix,
  fetchAnalysis,
  fetchCuts,
  generateAudio,
  libraryAudio,
  pictureUrl,
  renderPreview,
  RequestError,
  uploadAudio,
  uploadVideo,
  type Analysis,
  type AudioSource,
  type VideoInfo,
} from "../mix-api";
import {
  addClip,
  addMoments,
  addTrack,
  contentEnd,
  editClip,
  editMoment,
  editTrack,
  findClip,
  findMoment,
  hasContent,
  history,
  initialDoc,
  initialHistory,
  MOMENTS,
  newClip,
  newMoment,
  projectFile,
  removeItem,
  removeTrack,
  ROLE_COLORS,
  ROLE_LABELS,
  ROLES,
  sampleAlign,
  suggestMoments,
  toFrame,
  toProject,
  type ClipSource,
  type Cut,
  type MixDoc,
  type MomentDoc,
  type MomentKind,
  type Role,
  type Selection,
  type TrackDoc,
} from "../mix-store";
import { Player } from "../player";
import { HeaderSlot, Kbd, ShortcutHint, useScreen, type ScreenProps } from "../shell";
import type { Library } from "../source";
import { formatTime } from "../visuals";

/** Edits settle this long before the mix renders again. */
const RENDER_DEBOUNCE = 250;
/** Decoded renders kept for instant undo and A/B (bytes of float samples). */
const CACHE_BYTES = 400e6;
/** The preview is at most this long (the export is the whole project). */
const PREVIEW_SECONDS = 600;
const SENSITIVITY = [
  { threshold: 18, label: "Fewer cuts" },
  { threshold: 10, label: "Normal" },
  { threshold: 6, label: "More cuts" },
];

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mxf|mts|m2ts|wmv|flv|3gp)$/i;
const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);
/** Where a dropped audio file goes when no track is selected: by its name, else the voice. */
const roleFromName = (name: string): Role => (/music|song|beat|score|track|instrumental|loop/i.test(name) ? "music" : /sfx|whoosh|hit|impact|boom|riser|swoosh|foley/i.test(name) ? "sfx" : "voice");
const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

type Cached = { buffer: AudioBuffer; ms: number; id: string; analysis?: Analysis };
type CutMenu = { cut: Cut; anchor: HTMLElement; view: "menu" | "samples" };

/** The SFX track moments and samples go to: the selected one, else the first, else a new one. */
function sfxTrack(doc: MixDoc, preferred: string | null): { doc: MixDoc; id: string } {
  const chosen = doc.tracks.find((t) => t.id === preferred && t.role === "sfx") ?? doc.tracks.find((t) => t.role === "sfx");
  if (chosen) return { doc, id: chosen.id };
  const added = addTrack(doc, "sfx");
  return { doc: added.doc, id: added.track.id };
}

/**
 * Lay voice, music and effects against a video: the picture follows the mix you hear, cuts show on the
 * ruler, moments and samples land on them, and the export is the mix or the video with its new audio.
 */
export function MixScreen({ active }: ScreenProps) {
  const player = useMemo(() => {
    const p = new Player();
    // A timeline plays to its end and stops, it does not loop.
    p.loop = false;
    return p;
  }, []);
  const [, force] = useState(0);
  useEffect(() => {
    player.onChange = () => force((x) => x + 1);
  }, [player]);

  const [hist, dispatch] = useReducer(history, undefined, () => initialHistory(initialDoc()));
  const doc = hist.present;
  const edit = useCallback((apply: (d: MixDoc) => MixDoc, group?: string) => dispatch({ type: "edit", apply, group, at: performance.now() }), []);
  const [selection, setSelection] = useState<Selection>({ kind: "master" });

  const [started, setStarted] = useState(false);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [picture, setPicture] = useState<PictureState>({ status: "preparing", src: null, proxy: false });
  const [videoLoading, setVideoLoading] = useState<{ name: string; progress: number } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(10);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [cutsState, setCutsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState<{ track: string; label: string } | null>(null);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [heard, setHeard] = useState<{ key: string; id: string } | null>(null);
  const [analysis, setAnalysis] = useState<{ key: string; value: Analysis } | null>(null);
  const [cutMenu, setCutMenu] = useState<CutMenu | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [jsonNote, setJsonNote] = useState<string[] | null>(null);
  const [revealKeys, setRevealKeys] = useState(false);
  const cache = useRef(new Map<string, Cached>());
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const silent = useRef<AudioBuffer | null>(null);

  const fps = video?.fps ?? null;
  const frame = 1 / (fps ?? 30);
  const end = useMemo(() => contentEnd(doc), [doc]);
  const span = video ? video.duration : Math.max(15, Math.ceil(end + 5));
  const selectedTrack = selection.kind === "track" ? selection.id : selection.kind === "clip" ? (findClip(doc, selection.id)?.track.id ?? null) : selection.kind === "moment" ? (findMoment(doc, selection.id)?.track.id ?? null) : null;

  const refreshLibrary = useCallback(async (refresh = false) => {
    const data = (await fetch(`/api/library${refresh ? "?refresh=1" : ""}`).then((r) => r.json())) as Library;
    setLibrary(data);
    return data;
  }, []);
  useEffect(() => {
    void refreshLibrary().catch(() => null);
  }, [refreshLibrary]);
  const samples = useMemo<SampleOption[]>(() => (library?.items ?? []).filter((i) => i.kind === "sfx").map(({ id, name, folder }) => ({ id, name, folder })), [library]);

  // -------------------------------------------------------------------------------------------------------
  // The video

  const loadVideo = async (file: File) => {
    setVideoError(null);
    setVideoLoading({ name: file.name, progress: 0 });
    try {
      const info = await uploadVideo(file, (progress) => setVideoLoading({ name: file.name, progress }));
      if (video) dropVideo(video.id);
      player.clear();
      setVideo(info);
      setJsonNote(null);
      setStarted(true);
      setCuts([]);
      if (info.picture === "original") setPicture({ status: "ready", src: pictureUrl(info.id), proxy: false });
      else {
        setPicture({ status: "preparing", src: null, proxy: true });
        ensureProxy(info.id).then(
          () => setPicture({ status: "ready", src: pictureUrl(info.id, 1), proxy: true }),
          (error) => setPicture({ status: "error", src: null, proxy: true, message: (error as Error).message }),
        );
      }
      if (info.audio) {
        const wav = await fetch(`/api/sources/${info.audio.id}.wav`).then((r) => r.arrayBuffer());
        await player.load("original", wav);
      }
    } catch (error) {
      // An audio file in a video container: it goes on a track instead.
      if (error instanceof RequestError && error.code === "no-picture") {
        setStarted(true);
        addUpload(file, null);
      } else setVideoError((error as Error).message);
    } finally {
      setVideoLoading(null);
    }
  };

  /** The browser refused a picture the probe expected it to play: fall back to a preview copy. */
  const onPictureError = () => {
    if (!video) return;
    if (picture.proxy) return setPicture({ status: "error", src: null, proxy: true, message: "This browser cannot show the preview copy either." });
    setPicture({ status: "preparing", src: null, proxy: true });
    ensureProxy(video.id).then(
      () => setPicture({ status: "ready", src: pictureUrl(video.id, 1), proxy: true }),
      (error) => setPicture({ status: "error", src: null, proxy: true, message: (error as Error).message }),
    );
  };

  const removeVideo = () => {
    if (!video) return;
    dropVideo(video.id);
    player.clear();
    setVideo(null);
    setCuts([]);
    setCutsState("idle");
  };

  useEffect(() => {
    if (!video) return;
    let live = true;
    setCutsState("loading");
    fetchCuts(video.id, threshold).then(
      (found) => {
        if (!live) return;
        setCuts(found);
        setCutsState("ready");
      },
      () => live && setCutsState("error"),
    );
    return () => {
      live = false;
    };
  }, [video, threshold]);

  // -------------------------------------------------------------------------------------------------------
  // Adding audio

  const place = (trackId: string, source: ClipSource, at: number) => {
    const role = doc.tracks.find((t) => t.id === trackId)?.role ?? "voice";
    const clip = newClip(source, at, role === "sfx" ? sampleAlign(source.name) : "start");
    edit((d) => addClip(d, trackId, clip));
    setSelection({ kind: "clip", id: clip.id });
    if (source.truncated) toast(`Only the first ${PREVIEW_SECONDS / 60} minutes of ${source.name} are used.`);
  };

  /** Fetches audio for a track (busy while it runs) and places it at the playhead. */
  const addTo = async (trackId: string, label: string, load: () => Promise<ClipSource>, at = player.time) => {
    setBusy({ track: trackId, label });
    try {
      place(trackId, await load(), at);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fromSource = (source: AudioSource, file: string, fileName: string): ClipSource => ({
    file,
    sourceId: source.id,
    name: source.name,
    fileName,
    duration: source.duration,
    truncated: source.truncated,
  });

  const pickFor = (trackId: string, ref: SourceRef) => {
    if (ref.type === "upload") {
      uploadTarget.current = trackId;
      uploadInput.current?.click();
      return;
    }
    if (ref.type === "library") {
      const item = library?.items.find((i) => i.id === ref.id);
      return void addTo(trackId, `Opening ${item?.name ?? "audio"}…`, async () => fromSource(await libraryAudio(ref.id), `library:${ref.id}`, item?.name ?? ref.id));
    }
    if (ref.type === "demo") return void addTo(trackId, "Generating demo…", async () => {
      const s = await demoAudio(ref.kind);
      return fromSource(s, s.id, s.name);
    });
    void addTo(trackId, "Generating with ElevenLabs…", async () => {
      const s = await generateAudio(ref.request);
      void refreshLibrary();
      // Saved in the library: the project file can name it by its library id.
      return fromSource(s, s.libraryId ? `library:${s.libraryId}` : s.id, s.name);
    });
  };

  const addUpload = (file: File, trackId: string | null) => {
    const target = trackId ?? doc.tracks.find((t) => t.id === selectedTrack)?.id ?? doc.tracks.find((t) => t.role === roleFromName(file.name))?.id ?? doc.tracks[0]?.id;
    if (!target) return toast("Add a track first.");
    void addTo(target, `Loading ${file.name}…`, async () => {
      const s = await uploadAudio(file);
      return fromSource(s, s.id, file.name);
    });
  };

  const addVideoSound = (trackId: string) => {
    if (!video?.audio) return;
    place(trackId, fromSource(video.audio, video.audio.id, video.name), 0);
  };

  /** Header upload and dropped files: a video becomes the picture; audio goes on a track at the playhead. */
  const onFile = (file: File) => {
    if (isVideoFile(file)) return void loadVideo(file);
    setStarted(true);
    addUpload(file, null);
  };
  const { toast, pickFile } = useScreen(
    active,
    player,
    onFile,
    started && video ? "Drop audio to add it at the playhead, or a video to replace the picture" : "Drop a video (or audio to mix without one)",
  );

  // -------------------------------------------------------------------------------------------------------
  // Moments

  const addMomentsTo = (moments: MomentDoc[], trackId: string | null) => {
    edit((d) => {
      const target = sfxTrack(d, trackId);
      return addMoments(target.doc, target.id, moments);
    });
  };

  const addMomentAt = (kind: MomentKind, at: number, trackId: string | null = selectedTrack) => {
    const moment = newMoment(kind, at);
    addMomentsTo([moment], trackId);
    setSelection({ kind: "moment", id: moment.id });
  };

  const addSampleAt = async (item: LibraryItem, at: number) => {
    const target = sfxTrack(doc, selectedTrack);
    setBusy({ track: target.id, label: `Opening ${item.name}…` });
    try {
      const source = fromSource(await libraryAudio(item.id), `library:${item.id}`, item.name);
      const clip = newClip(source, at, sampleAlign(item.name));
      edit((d) => {
        const t = sfxTrack(d, selectedTrack);
        return addClip(t.doc, t.id, clip);
      });
      setSelection({ kind: "clip", id: clip.id });
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const suggest = () => {
    const existing = doc.tracks.filter((t) => t.role === "sfx").flatMap((t) => [...t.moments.map((m) => m.at), ...t.clips.map((c) => c.at)]);
    const moments = suggestMoments(cuts, span, existing);
    if (!moments.length) {
      toast(existing.length ? "Enough moments for this length already" : "No cut to suggest a moment on");
      return;
    }
    addMomentsTo(moments, selectedTrack);
    toast(`${moments.length} moment${moments.length > 1 ? "s" : ""} on the strongest cuts · Ctrl+Z undoes`);
  };

  // -------------------------------------------------------------------------------------------------------
  // Rendering what you hear

  const project = useMemo(() => (hasContent(doc) ? toProject(doc, video ? { video: video.id } : { duration: Math.min(PREVIEW_SECONDS, Math.max(0.5, end)) }) : null), [doc, video, end]);
  const projectKey = useMemo(() => (project ? JSON.stringify(project) : null), [project]);

  useEffect(() => {
    if (!started) return;
    if (!project || !projectKey) {
      setRender({ status: "idle" });
      setHeard(null);
      if (video) {
        // Nothing to hear yet: a silent buffer as long as the video drives the clock the picture follows.
        const length = Math.min(video.duration, PREVIEW_SECONDS);
        if (!silent.current || Math.abs(silent.current.duration - length) > 0.01) silent.current = player.ctx.createBuffer(1, Math.max(1, Math.round(length * 8000)), 8000);
        player.setBuffer("processed", silent.current);
      } else player.dropProcessed();
      return;
    }
    const hit = cache.current.get(projectKey);
    if (hit) {
      player.setBuffer("processed", hit.buffer);
      setRender({ status: "ready", ms: hit.ms });
      setHeard({ key: projectKey, id: hit.id });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRender((r) => ({ ...r, status: "rendering" }));
      try {
        const { data, ms, id } = await renderPreview(project, controller.signal);
        const buffer = await player.ctx.decodeAudioData(data);
        if (controller.signal.aborted) return;
        const entries = cache.current;
        entries.set(projectKey, { buffer, ms, id });
        let bytes = 0;
        for (const e of entries.values()) bytes += e.buffer.length * e.buffer.numberOfChannels * 4;
        for (const [k, e] of entries) {
          if (bytes <= CACHE_BYTES || entries.size <= 1) break;
          bytes -= e.buffer.length * e.buffer.numberOfChannels * 4;
          entries.delete(k);
        }
        player.setBuffer("processed", buffer);
        setRender({ status: "ready", ms });
        setHeard({ key: projectKey, id });
      } catch (error) {
        if (!controller.signal.aborted) setRender({ status: "error", error: (error as Error).message });
      }
    }, RENDER_DEBOUNCE);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [started, project, projectKey, video, player]);

  // Loudness and true peak of what you hear, measured by the server once per render.
  useEffect(() => {
    if (!heard) return;
    const entry = cache.current.get(heard.key);
    if (entry?.analysis) return setAnalysis({ key: heard.key, value: entry.analysis });
    let live = true;
    fetchAnalysis(heard.id).then(
      (value) => {
        if (entry) entry.analysis = value;
        if (live) setAnalysis({ key: heard.key, value });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [heard]);
  const analysisStale = !heard || analysis?.key !== heard.key || render.status === "rendering";

  // -------------------------------------------------------------------------------------------------------
  // Editing

  const onEditClip = useCallback((id: string, patch: Parameters<typeof editClip>[2], group?: string) => edit((d) => editClip(d, id, patch), group), [edit]);
  const onEditMoment = useCallback((id: string, patch: Partial<MomentDoc>, group?: string) => edit((d) => editMoment(d, id, patch), group), [edit]);
  const onEditTrack = useCallback((id: string, patch: Partial<TrackDoc>, group?: string) => edit((d) => editTrack(d, id, patch), group), [edit]);

  const removeSelected = useCallback(
    (id: string) => {
      const owner = findClip(doc, id)?.track ?? findMoment(doc, id)?.track;
      edit((d) => removeItem(d, id));
      setSelection(owner ? { kind: "track", id: owner.id } : { kind: "master" });
    },
    [doc, edit],
  );

  const newTrackOf = (role: Role) => {
    const { track } = addTrack(doc, role);
    edit((d) => addTrack(d, role).doc);
    setSelection({ kind: "track", id: track.id });
  };

  const seek = useCallback((t: number) => player.seek(Math.max(0, Math.min(span, t))), [player, span]);
  const audition = (t: number) => {
    player.seek(Math.max(0, t - 1));
    void player.play();
  };
  const canCompare = !!player.peek("original");
  const holdOriginal = useCallback((on: boolean) => player.setTrack(on && player.peek("original") ? "original" : "processed"), [player]);

  // Shortcuts, only while this screen is shown.
  useEffect(() => {
    if (!active) {
      setRevealKeys(false);
      return;
    }
    const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setRevealKeys(true);
      if (typing(e) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if ((e.key === "a" || e.key === "A") && !e.repeat) holdOriginal(true);
      else if (e.key === "Escape") {
        setSelection({ kind: "master" });
        setCutMenu(null);
      } else if (e.key === "Home") seek(0);
      else if ((e.key === "Delete" || e.key === "Backspace") && (selection.kind === "clip" || selection.kind === "moment")) {
        e.preventDefault();
        removeSelected(selection.id);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        // A frame (ten with Shift): the selected clip or moment, else the playhead.
        const delta = (e.shiftKey ? 10 : 1) * frame * (e.key === "ArrowLeft" ? -1 : 1);
        if (selection.kind === "clip") {
          const id = selection.id;
          edit((d) => {
            const found = findClip(d, id);
            return found ? editClip(d, id, { at: Math.max(0, toFrame(found.clip.at + delta, fps)) }) : d;
          }, `nudge:${id}`);
        } else if (selection.kind === "moment") {
          const id = selection.id;
          edit((d) => {
            const found = findMoment(d, id);
            return found ? editMoment(d, id, { at: Math.max(0, toFrame(found.moment.at + delta, fps)) }) : d;
          }, `nudge:${id}`);
        } else seek(toFrame(player.time + delta, fps));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setRevealKeys(false);
      if (e.key === "a" || e.key === "A") holdOriginal(false);
    };
    const blur = () => {
      setRevealKeys(false);
      holdOriginal(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [active, player, selection, frame, fps, edit, seek, holdOriginal, removeSelected]);

  // -------------------------------------------------------------------------------------------------------
  // Export

  const runExport = async (kind: ExportKind) => {
    if (kind === "json") {
      const { json, toPoint } = projectFile(doc, video ? { videoName: video.name } : { duration: Math.max(0.5, end) });
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      download(url, `${video ? baseName(video.name) : "AudioFX"} mix.json`);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setJsonNote(toPoint);
      return;
    }
    setExporting(kind);
    try {
      const result = await exportMix(project ?? toProject(doc, { video: video?.id }), kind);
      download(result.url, result.name);
      toast(`${result.name} · ${(result.size / 1e6).toFixed(1)} MB`);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setExporting(null);
    }
  };

  // -------------------------------------------------------------------------------------------------------
  // Track headers and empty lanes

  const trackTools = (track: TrackDoc) => {
    const loading = busy?.track === track.id ? busy.label : null;
    return (
      <>
        <SourcePicker
          className="static"
          current={null}
          loading={loading}
          library={library}
          kind={track.role}
          onPick={(ref) => pickFor(track.id, ref)}
          onUpload={() => pickFor(track.id, { type: "upload" })}
          onRefresh={() => void refreshLibrary(true)}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={(e) => {
                toggle();
                if (open) return;
                // The panel opens under the track: scroll it clear of the screen's bottom (the phone's transport).
                const header = e.currentTarget.closest("[data-track-header]");
                requestAnimationFrame(() => {
                  const panel = header?.querySelector('[role="dialog"]')?.getBoundingClientRect();
                  if (panel && panel.bottom > window.innerHeight - 72) window.scrollBy({ top: panel.bottom - window.innerHeight + 80, behavior: "smooth" });
                });
              }}
              aria-expanded={open}
              disabled={!!loading}
              aria-label={`Add audio to ${track.name}`}
              title={loading ?? `Add audio to ${track.name}: your library, an upload or ElevenLabs`}
              className="grid size-6 cursor-pointer place-items-center rounded-full bg-muted transition-colors hover:bg-muted-strong disabled:cursor-wait"
            >
              {loading ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> : <Plus className="size-3.5" strokeWidth={1.5} />}
            </button>
          )}
        />
        {track.role === "sfx" && <MomentButton onPick={(kind) => addMomentAt(kind, player.time, track.id)} />}
      </>
    );
  };

  const laneHint = (track: TrackDoc) => {
    const text = "text-xs whitespace-nowrap text-muted-foreground";
    if (track.role === "voice" && video?.audio && !doc.tracks.some((t) => t.clips.some((c) => c.sourceId === video.audio!.id)))
      return (
        <span className={cn(text, "flex items-center gap-2")}>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-card px-2.5 text-foreground shadow-ring hover:bg-muted"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => addVideoSound(track.id)}
          >
            <Clapperboard className="size-3.5" strokeWidth={1.5} /> Use the video's sound
          </button>
          <span className="max-sm:hidden">or + for a voice</span>
        </span>
      );
    if (track.role === "music") return <span className={text}>+ adds music · it ducks under the voice</span>;
    if (track.role === "sfx") return <span className={text}>{cuts.length ? "Tap a cut on the ruler for a moment" : "+ adds a sample · ⚡ a moment at the playhead"}</span>;
    return <span className={text}>+ adds a voice, or drop a file</span>;
  };

  const cutsLabel = !video ? (
    "No video"
  ) : cutsState === "loading" ? (
    <span className="inline-flex items-center gap-1">
      <LoaderCircle className="size-3 animate-spin" strokeWidth={1.5} /> Finding cuts
    </span>
  ) : cutsState === "error" ? (
    "Cuts unavailable"
  ) : (
    `${cuts.length} cut${cuts.length === 1 ? "" : "s"}`
  );

  // -------------------------------------------------------------------------------------------------------

  const header = (
    <HeaderSlot active={active}>
      <ShortcutHint revealed={revealKeys}>
        <Kbd>Space</Kbd> play <Kbd>A</Kbd> video's sound <Kbd>←→</Kbd> nudge a frame <Kbd>⇧</Kbd> ×10 <Kbd>Del</Kbd> remove <Kbd>Ctrl Z</Kbd> undo
      </ShortcutHint>
    </HeaderSlot>
  );

  if (!started)
    return (
      <>
        {header}
        <div className="mx-auto max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8">
          <PictureEmpty loading={videoLoading} error={videoError} onPick={pickFile} onAudioOnly={() => setStarted(true)} />
        </div>
      </>
    );

  return (
    <>
      {header}
      <input
        ref={uploadInput}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) addUpload(file, uploadTarget.current);
          uploadTarget.current = null;
          e.target.value = "";
        }}
      />
      {/* Desktop: picture and inspector side by side, the timeline across the full width under them. Phone:
          picture, timeline, then the inspector, with the transport fixed to the bottom. */}
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 max-lg:pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:gap-6 lg:px-8">
        <div className="min-w-0 space-y-3">
          {video ? (
            <section aria-label="Picture" className="rounded-[28px] bg-card p-3 shadow-card sm:p-4">
              <VideoPreview
                player={player}
                picture={picture}
                fps={video.fps ?? 25}
                aspect={video.width && video.height ? video.width / video.height : 16 / 9}
                reason={video.reason}
                onPictureError={onPictureError}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]" title={video.name}>
                    {video.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {[video.width && video.height ? `${video.width}×${video.height}` : null, fps ? `${Number(fps.toFixed(3))} fps` : null, video.codec, formatTime(video.duration), video.audio ? "with sound" : "no sound"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={pickFile} disabled={!!videoLoading}>
                  {videoLoading ? <LoaderCircle className="animate-spin" strokeWidth={1.5} /> : <Upload strokeWidth={1.5} />}
                  {videoLoading ? `${Math.round(videoLoading.progress * 100)}%` : "Replace"}
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={removeVideo} aria-label="Remove the video" title="Remove the video (the tracks stay)">
                  <X strokeWidth={1.5} />
                </Button>
              </div>
              {videoError && <p className="mt-2 px-1 text-xs text-danger">{videoError}</p>}
              {video.duration > PREVIEW_SECONDS && (
                <p className="mt-2 px-1 text-xs text-muted-foreground">You hear the first {PREVIEW_SECONDS / 60} minutes while you mix; the export covers the whole video.</p>
              )}
            </section>
          ) : (
            <section aria-label="No video" className="flex flex-wrap items-center gap-3 rounded-[28px] bg-card p-4 shadow-card sm:p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                <AudioLines className="size-5" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px]">Mixing without a video</p>
                <p className="text-xs text-pretty text-muted-foreground">{videoError ?? "The mix lasts until its last sound. Load a video to see its cuts and export it with this audio."}</p>
              </div>
              <Button size="sm" onClick={pickFile} disabled={!!videoLoading}>
                {videoLoading ? <LoaderCircle className="animate-spin" strokeWidth={1.5} /> : <Clapperboard strokeWidth={1.5} />}
                {videoLoading ? `${Math.round(videoLoading.progress * 100)}%` : "Load a video"}
              </Button>
            </section>
          )}

          <Transport
            player={player}
            span={span}
            fps={fps}
            render={render}
            canCompare={canCompare}
            onHoldOriginal={holdOriginal}
            exportMenu={<ExportMenu hasContent={hasContent(doc)} videoName={video?.name ?? null} busy={exporting} onExport={(kind) => void runExport(kind)} />}
          />
          {project && <MixMeter player={player} analysis={analysis?.value ?? null} stale={analysisStale} loudness={doc.loudness} render={render} />}
          {jsonNote && (
            <p className="flex items-start gap-2 rounded-2xl bg-muted/70 px-3 py-2 text-xs text-pretty">
              <Info className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1">
                Project saved for <code className="font-mono">sfx mix</code>.{" "}
                {jsonNote.length ? (
                  <>
                    Replace these names with the paths of your files: <span className="font-mono break-words">{jsonNote.join(", ")}</span>. Library sounds (<code className="font-mono">library:</code>) resolve on their own.
                  </>
                ) : (
                  "Everything in it comes from your library: it renders as is."
                )}
              </span>
              <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setJsonNote(null)} aria-label="Dismiss">
                <X className="size-3.5" strokeWidth={1.5} />
              </button>
            </p>
          )}
        </div>

        {/* The inspector is as tall as the picture column and scrolls inside it (desktop); on a phone it comes last. */}
        <aside className="min-w-0 max-lg:order-last lg:relative lg:min-h-[420px]">
          <div className="lg:absolute lg:inset-0 lg:overflow-y-auto lg:overscroll-contain lg:rounded-[28px]">
            <Inspector
              doc={doc}
              selection={selection}
              player={player}
              samples={samples}
              analysis={analysis?.value ?? null}
              analysisStale={analysisStale}
              onEditClip={onEditClip}
              onEditMoment={onEditMoment}
              onEditTrack={onEditTrack}
              onLoudness={(loudness) => edit((d) => ({ ...d, loudness }))}
              onRemove={removeSelected}
              onRemoveTrack={(id) => {
                edit((d) => removeTrack(d, id));
                setSelection({ kind: "master" });
              }}
              onAudition={audition}
              onClose={() => setSelection({ kind: "master" })}
            />
          </div>
        </aside>

        <div className="min-w-0 lg:col-span-2">
          <Timeline
            doc={doc}
            span={span}
            fps={fps}
            player={player}
            cuts={cuts}
            selection={selection}
            onSelect={setSelection}
            onSeek={seek}
            onEditClip={onEditClip}
            onEditMoment={onEditMoment}
            onEditTrack={onEditTrack}
            onCut={(cut, anchor) => setCutMenu({ cut, anchor, view: "menu" })}
            trackTools={trackTools}
            laneHint={laneHint}
            cutsLabel={cutsLabel}
            ctx={player.ctx}
            toolbar={
              <>
                <Button size="icon-sm" variant="ghost" onClick={() => dispatch({ type: "undo" })} disabled={!hist.past.length} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">
                  <Undo2 strokeWidth={1.5} />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => dispatch({ type: "redo" })} disabled={!hist.future.length} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)">
                  <Redo2 strokeWidth={1.5} />
                </Button>
                <Button size="sm" variant="ghost" onClick={suggest} disabled={!cuts.length} title="One or two moments per 15 s on the strongest cuts (undoable)">
                  <Sparkles strokeWidth={1.5} /> Suggest moments
                </Button>
                <AddTrackButton onAdd={newTrackOf} />
                {video && (
                  <label className="relative inline-flex h-8 items-center rounded-full bg-muted text-[13px] transition-colors hover:bg-muted-strong" title="How different two frames must be to count as a cut">
                    <select
                      aria-label="Cut detection"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="h-full cursor-pointer appearance-none rounded-full bg-transparent pr-3 pl-3 outline-none focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]"
                    >
                      {SENSITIVITY.map((s) => (
                        <option key={s.threshold} value={s.threshold}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            }
          />
        </div>
      </div>

      {cutMenu && (
        <CutPopover
          menu={cutMenu}
          samples={(library?.items ?? []).filter((i) => i.kind === "sfx")}
          onClose={() => setCutMenu(null)}
          onView={(view) => setCutMenu({ ...cutMenu, view })}
          onMoment={(kind) => {
            addMomentAt(kind, cutMenu.cut.time);
            setCutMenu(null);
          }}
          onSample={(item) => {
            void addSampleAt(item, cutMenu.cut.time);
            setCutMenu(null);
          }}
          onSeek={() => {
            seek(cutMenu.cut.time);
            setCutMenu(null);
          }}
        />
      )}
    </>
  );
}

/** ⚡ on an SFX track: a synthesized moment at the playhead. */
function MomentButton({ onPick }: { onPick: (kind: MomentKind) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-expanded={!!anchor}
        aria-label="Add a moment at the playhead"
        title="Add a moment at the playhead"
        className="grid size-6 cursor-pointer place-items-center rounded-full bg-muted transition-colors hover:bg-muted-strong"
      >
        <Zap className="size-3.5" strokeWidth={1.5} />
      </button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Add a moment at the playhead" width={280}>
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">At the playhead</p>
        {MOMENTS.map((m) => (
          <MenuRow
            key={m.kind}
            icon={<Zap strokeWidth={1.5} />}
            title={m.label === "Hit on the cut" ? "Hit" : m.label}
            sub={m.hint}
            onClick={() => {
              setAnchor(null);
              onPick(m.kind);
            }}
          />
        ))}
      </Popover>
    </>
  );
}

function AddTrackButton({ onAdd }: { onAdd: (role: Role) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} aria-expanded={!!anchor}>
        <Plus strokeWidth={1.5} /> Track
      </Button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Add a track" width={260}>
        {ROLES.map((role) => (
          <MenuRow
            key={role}
            icon={<span className="size-2.5 rounded-full" style={{ background: ROLE_COLORS[role] }} />}
            title={`${ROLE_LABELS[role]} track`}
            sub={role === "voice" ? "The others duck under it" : role === "music" ? "Ducks under the voice" : "Moments and samples"}
            onClick={() => {
              setAnchor(null);
              onAdd(role);
            }}
          />
        ))}
      </Popover>
    </>
  );
}

/** What a cut marker offers: a moment that lands on it, a sample from the library, or the playhead. */
function CutPopover(props: {
  menu: CutMenu;
  samples: LibraryItem[];
  onClose: () => void;
  onView: (view: CutMenu["view"]) => void;
  onMoment: (kind: MomentKind) => void;
  onSample: (item: LibraryItem) => void;
  onSeek: () => void;
}) {
  const { cut, anchor, view } = props.menu;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const found = props.samples.filter((s) => !q || `${s.name} ${s.folder}`.toLowerCase().includes(q));
  return (
    <Popover anchor={anchor} onClose={props.onClose} label={`Cut at ${formatTime(cut.time)}`} width={300}>
      <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
        Cut at <span className="font-mono">{formatTime(cut.time)}</span> · score <span className="font-mono">{cut.score.toFixed(1)}</span>
      </p>
      {view === "menu" ? (
        <>
          {MOMENTS.filter((m) => m.kind === "hit" || m.kind === "whoosh" || m.kind === "riser-hit").map((m) => (
            <MenuRow key={m.kind} icon={<Zap strokeWidth={1.5} />} title={m.label} sub={m.hint} onClick={() => props.onMoment(m.kind)} />
          ))}
          <MenuRow icon={<Search strokeWidth={1.5} />} title="Sample…" sub="A sound effect from your library, by its attack" onClick={() => props.onView("samples")} />
          <MenuRow icon={<Crosshair strokeWidth={1.5} />} title="Move the playhead here" onClick={props.onSeek} />
        </>
      ) : (
        <>
          <label className="relative block p-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
            <input
              autoFocus
              className="h-10 w-full rounded-full bg-muted pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground focus:bg-card focus:shadow-ring"
              placeholder="Search your sound effects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="max-h-[min(40dvh,22rem)] overflow-y-auto">
            {found.map((item) => (
              <MenuRow key={item.id} icon={<Sparkles strokeWidth={1.5} />} title={item.name} sub={`${item.folder} · lands by its ${sampleAlign(item.name) === "peak" ? "loudest point" : "attack"}`} onClick={() => props.onSample(item)} />
            ))}
            {!found.length && (
              <p className="px-3 py-5 text-center text-sm text-pretty text-muted-foreground">
                {props.samples.length ? `Nothing matches “${query}”.` : "No sound effects in your library yet. Generate one from the SFX track's +."}
              </p>
            )}
          </div>
          <button type="button" className="mt-1 w-full cursor-pointer rounded-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => props.onView("menu")}>
            ← Moments
          </button>
        </>
      )}
    </Popover>
  );
}
