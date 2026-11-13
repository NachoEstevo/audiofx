import { Upload } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Player } from "./player";
import { hrefOf, useHashPath } from "./router";

export interface ScreenProps {
  /**
   * false while another screen is shown. The screen stays mounted so its state survives the trip, but it
   * must stay silent (useScreen pauses its player) and drop its global key handlers.
   */
  active: boolean;
}

/** A screen of the studio: adding one is one entry in the routes array (App.tsx). */
export interface Route {
  path: string;
  label: string;
  component: ComponentType<ScreenProps>;
}

interface Attached {
  player: Player;
  onFile?: (file: File) => void;
  /** What the drop overlay says a dropped file becomes. */
  dropLabel?: string;
}

interface ShellApi {
  toast: (text: string) => void;
  pickFile: () => void;
  attach: (screen: Attached) => () => void;
  header: HTMLElement | null;
}

const ShellContext = createContext<ShellApi | null>(null);

function useShell(): ShellApi {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("Screens render inside <Shell>.");
  return shell;
}

/**
 * What a screen gets from the shell. While it is active, its player drives the header logo and `onFile`
 * receives the header upload and dropped files (without it, the upload button is hidden); when another
 * screen is shown, its audio stops.
 */
export function useScreen(active: boolean, player: Player, onFile?: (file: File) => void, dropLabel?: string) {
  const shell = useShell();
  const fileRef = useRef(onFile);
  fileRef.current = onFile;
  const acceptsFiles = !!onFile;
  useEffect(() => {
    if (!active) {
      if (player.playing) player.pause();
      // Lets go of a held "original" so the screen comes back on the processed track.
      player.setTrack("processed");
      return;
    }
    return shell.attach({ player, onFile: acceptsFiles ? (file) => fileRef.current?.(file) : undefined, dropLabel });
  }, [active, player, shell, acceptsFiles, dropLabel]);
  return { toast: shell.toast, pickFile: shell.pickFile };
}

/** The active screen's own header controls (its shortcut hints), rendered into the shell's header. */
export function HeaderSlot({ active, children }: { active: boolean; children: ReactNode }) {
  const { header } = useShell();
  return active && header ? createPortal(children, header) : null;
}

/** Shortcuts as a reminder in place: dimmed "Hold Shift" until Shift is down. */
export function ShortcutHint({ revealed, children }: { revealed: boolean; children: ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground transition-opacity duration-200", revealed ? "opacity-100" : "opacity-60")}>
      {revealed ? (
        children
      ) : (
        <>
          Hold <Kbd>Shift</Kbd> for shortcuts
        </>
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{children}</kbd>;
}

function HeaderLogo({ player }: { player: Player | null }) {
  const subscribe = useCallback((fn: () => void) => player?.subscribe(fn) ?? (() => {}), [player]);
  const playing = useSyncExternalStore(subscribe, () => player?.playing ?? false);
  return <Logo playing={playing} getLevel={() => player?.level() ?? 0} />;
}

/**
 * The studio frame: header with navigation, the hash route, the toast and file drops. A screen is mounted
 * the first time it is opened and then kept (hidden) so its source, chain and render cache survive.
 */
export function Shell({ routes }: { routes: Route[] }) {
  const path = useHashPath();
  const current = routes.find((r) => r.path === path) ?? routes[0];
  const [mounted, setMounted] = useState<string[]>([current.path]);
  if (!mounted.includes(current.path)) setMounted([...mounted, current.path]);
  const [attached, setAttached] = useState<Attached | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onFile = attached?.onFile;

  const shell = useMemo<ShellApi>(
    () => ({
      toast: (text) => setToast({ id: Date.now(), text }),
      pickFile: () => fileInput.current?.click(),
      attach: (screen) => {
        setAttached(screen);
        return () => setAttached((a) => (a === screen ? null : a));
      },
      header,
    }),
    [header],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.title = current === routes[0] ? "AudioFX Studio" : `${current.label} · AudioFX Studio`;
  }, [current, routes]);

  return (
    <ShellContext.Provider value={shell}>
      <div
        className="min-h-dvh"
        onDragOver={(e) => {
          e.preventDefault();
          if (onFile) setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile?.(file);
        }}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-8">
          <HeaderLogo player={attached?.player ?? null} />
          {/* On a phone the logo stands for the name: the room goes to the navigation. */}
          <span className="font-display text-[17px] tracking-[-0.02em] whitespace-nowrap max-sm:sr-only">
            AudioFX <span className="text-muted-foreground">Studio</span>
          </span>
          <NavPills routes={routes} current={current} />
          <div ref={setHeader} className="ml-auto hidden min-w-0 items-center overflow-hidden lg:flex" />
          {onFile && (
            <Button variant="primary" className="max-lg:ml-auto max-sm:w-9 max-sm:px-0" onClick={() => fileInput.current?.click()} aria-label="Upload audio or video">
              <Upload strokeWidth={1.5} />
              <span className="max-sm:hidden xl:hidden">Upload</span>
              <span className="hidden xl:inline">Upload audio or video</span>
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile?.(file);
              e.target.value = "";
            }}
          />
        </header>

        {routes.map(
          (route) =>
            mounted.includes(route.path) && (
              <div key={route.path} hidden={route !== current}>
                <route.component active={route === current} />
              </div>
            ),
        )}

        {toast && (
          <div key={toast.id} role="status" className="toast fixed bottom-6 left-1/2 z-50 rounded-full bg-foreground px-4 py-2.5 text-[13px] text-white shadow-float">
            {toast.text}
          </div>
        )}
        {dragging && onFile && (
          <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-3xl border-2 border-dashed border-foreground/30 bg-background/90 font-display text-2xl font-light tracking-[-0.02em]">
            {attached?.dropLabel ?? "Drop an audio or video file to use it as the source"}
          </div>
        )}
      </div>
    </ShellContext.Provider>
  );
}

/** Screen links as pills. One indicator slides and resizes to the current link, and the labels cross-fade their colour with it. */
function NavPills({ routes, current }: { routes: Route[]; current: Route }) {
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // Measured, not animated, on the first paint: the pill should not fly in from the corner.
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const place = () => {
      const el = links.current.get(current.path);
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    place();
    const frame = requestAnimationFrame(() => setMoving(true));
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [current.path]);
  return (
    <nav aria-label="Screens" className="no-scrollbar relative flex min-w-0 overflow-x-auto rounded-full bg-muted p-1">
      {pill && (
        <span
          aria-hidden
          className={cn("absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-ring motion-reduce:transition-none", moving && "transition-[translate,width] duration-[380ms] ease-[var(--ease-out)]")}
          style={{ translate: `${pill.left}px 0`, width: pill.width }}
        />
      )}
      {routes.map((route) => {
        const on = route === current;
        return (
          <a
            key={route.path}
            ref={(el) => {
              if (el) links.current.set(route.path, el);
              else links.current.delete(route.path);
            }}
            href={hrefOf(route.path)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative z-10 inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] whitespace-nowrap outline-none transition-colors duration-[380ms] ease-[var(--ease-out)] focus-visible:shadow-[0_0_0_2px_var(--color-foreground)] sm:px-3.5",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {route.label}
          </a>
        );
      })}
    </nav>
  );
}
