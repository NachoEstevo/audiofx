import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItem, SourceRef } from "@/components/source-picker";
import type { Player } from "./player";

export interface Source {
  id: string;
  name: string;
  duration: number;
}

export type Library = { items: LibraryItem[]; folders: string[] };

/** Where the moment marker starts on a new source: a third of the way in, at most 8 s. */
export const initialMoment = (duration: number) => Math.round(Math.min(duration * 0.35, 8) * 100) / 100;

/**
 * The audio a screen plays effects over: the library, the loaded source and how to switch it. Each screen
 * has its own (and its own player). On open it loads your first voice; otherwise the demo voice; if TTS is
 * unavailable, music.
 */
export function useSource(
  player: Player,
  on: {
    loaded: (source: Source) => void;
    failed: (message: string) => void;
    /** Opens the file picker; the file comes back through `uploadFile`. */
    pickFile: () => void;
  },
) {
  const [source, setSource] = useState<Source | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const handlers = useRef(on);
  handlers.current = on;

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
        handlers.current.loaded(info);
        if (wasPlaying) void player.play();
        return true;
      } catch (error) {
        handlers.current.failed((error as Error).message);
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
      handlers.current.pickFile();
      return Promise.resolve(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, loadSource],
  );

  const refreshLibrary = useCallback(async (refresh = false) => {
    const res = await fetch(`/api/library${refresh ? "?refresh=1" : ""}`);
    const data = (await res.json()) as Library;
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

  return { source, library, loading, pickSource, refreshLibrary, uploadFile };
}
