import { AudioLines, Clapperboard, LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Player } from "../../player";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Past this the picture jumps to the audio; below it a slight rate trim closes the gap without a visible seek. */
const MAX_DRIFT = 0.06;
/** The trim starts past this drift and stops once it is back under SETTLED (hysteresis: few rate changes). */
const TRIM_FROM = 0.015;
const SETTLED = 0.005;
const MAX_TRIM = 0.05;

export type PictureState = { status: "preparing" | "ready" | "error"; src: string | null; proxy: boolean; message?: string };

/**
 * The picture. What you hear is the rendered mix through the Player; the <video> is muted and only shows
 * frames, following the player's clock: play, pause and seek mirror it. Each presented frame
 * (requestVideoFrameCallback) is compared with the audio heard when it is displayed: the player's time at
 * that moment minus the output latency. Past 60 ms the picture seeks; past 15 ms its rate is trimmed by up
 * to 5 % until the gap is under 5 ms. The last drift goes to `data-sync-drift-ms` for inspection.
 */
export function VideoPreview(props: { player: Player; picture: PictureState; fps: number; /** Width / height of the picture. */ aspect: number; reason: string; onPictureError: () => void }) {
  const { player, picture, fps } = props;
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || !picture.src) return;
    let frame = 0;
    let reported = 0;
    // How long a seek takes to show a frame, so a correction lands where the audio will be by then.
    let lead = 0;
    let seekStarted = 0;
    const onSeeked = () => {
      if (!seekStarted) return;
      lead = Math.min(0.4, lead * 0.5 + ((performance.now() - seekStarted) / 1000) * 0.5);
      seekStarted = 0;
    };
    video.addEventListener("seeked", onSeeked);
    const latency = () => (player.ctx.outputLatency || 0) + (player.ctx.baseLatency || 0);

    // The drift of the last presented frame: its media time against the audio heard when it is displayed.
    let measured: { drift: number; at: number } | null = null;
    let callback = 0;
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      callback = video.requestVideoFrameCallback(onFrame);
      if (!player.playing || video.seeking) return;
      const heardThen = player.time + (meta.expectedDisplayTime - performance.now()) / 1000 - latency();
      measured = { drift: meta.mediaTime - heardThen, at: performance.now() };
    };
    const frames = "requestVideoFrameCallback" in video;
    if (frames) callback = video.requestVideoFrameCallback(onFrame);

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (video.readyState < 1) return;
      const end = Number.isFinite(video.duration) ? video.duration : Infinity;
      if (player.playing) {
        const heard = Math.min(end, Math.max(0, player.time - latency()));
        if (video.paused) {
          video.currentTime = heard;
          video.playbackRate = 1;
          measured = null;
          void video.play().catch(() => {});
          return;
        }
        if (video.seeking) return;
        const now = performance.now();
        // Without a fresh frame measurement (no rVFC, or a frame not shown yet), the element's clock.
        const drift = frames && measured && now - measured.at < 250 ? measured.drift : video.currentTime - heard;
        if (Math.abs(drift) > MAX_DRIFT) {
          seekStarted = now;
          measured = null;
          video.playbackRate = 1;
          video.currentTime = Math.min(end, heard + lead);
        } else if (Math.abs(drift) > TRIM_FROM || (video.playbackRate !== 1 && Math.abs(drift) > SETTLED)) {
          const rate = 1 - Math.max(-MAX_TRIM, Math.min(MAX_TRIM, drift * 1.5));
          if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
        } else if (video.playbackRate !== 1) video.playbackRate = 1;
        if (now - reported > 250) {
          reported = now;
          video.dataset.syncDriftMs = (drift * 1000).toFixed(1);
          video.dataset.syncLatencyMs = (latency() * 1000).toFixed(1);
        }
      } else {
        if (!video.paused) video.pause();
        measured = null;
        const t = Math.min(end, player.time);
        if (!video.seeking && Math.abs(video.currentTime - t) > 0.25 / fps) video.currentTime = t;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (frames) video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [player, picture.src, fps]);

  return (
    // In the picture's own shape: full width (at most half the screen high) on a phone; on a desktop at most
    // 38% of the screen high, so the timeline under it stays in view.
    <div
      className="relative mx-auto max-h-[50dvh] w-full max-w-full overflow-hidden rounded-2xl bg-[#0c0a09] lg:max-h-[min(38dvh,520px)] lg:w-[calc(min(38dvh,520px)*var(--aspect))]"
      style={{ aspectRatio: String(props.aspect), "--aspect": props.aspect } as React.CSSProperties}
    >
      {picture.src && (
        <video
          ref={ref}
          src={picture.src}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 size-full cursor-pointer object-contain"
          onClick={() => player.toggle()}
          onError={props.onPictureError}
          aria-label="Picture (follows the mix)"
        />
      )}
      {picture.status === "preparing" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/80">
          <div>
            <LoaderCircle className="mx-auto size-6 animate-spin" strokeWidth={1.5} />
            <p className="mt-3 text-sm">Preparing a preview of the picture…</p>
            <p className="mt-1 text-xs text-white/50">{props.reason} The export keeps your original.</p>
          </div>
        </div>
      )}
      {picture.status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/85">
          <div className="max-w-md">
            <TriangleAlert className="mx-auto size-6" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-pretty">{picture.message ?? "The picture could not be shown."}</p>
            <p className="mt-1 text-xs text-white/50">You can still mix and export: the export copies the original picture.</p>
          </div>
        </div>
      )}
      {picture.proxy && picture.status === "ready" && (
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur" title={props.reason}>
          Preview copy · export keeps the original
        </span>
      )}
    </div>
  );
}

/** Before a video: the drop zone, and a way to mix audio alone. */
export function PictureEmpty(props: { loading: { name: string; progress: number } | null; error: string | null; onPick: () => void; onAudioOnly: () => void }) {
  const { loading } = props;
  return (
    <section aria-label="Load a video" className="rounded-[28px] bg-card p-3 shadow-card sm:p-4">
      <div className="grid min-h-[min(56dvh,460px)] place-items-center rounded-[22px] border-2 border-dashed border-border px-5 py-10 text-center">
        {loading ? (
          <div className="w-full max-w-sm">
            <LoaderCircle className="mx-auto size-6 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <p className="mt-4 truncate text-[15px]">{loading.progress < 1 ? `Loading ${loading.name}` : `Reading ${loading.name}`}</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loading.progress * 100)}>
              <div className="h-full rounded-full bg-foreground transition-[width] duration-200" style={{ width: `${Math.round(loading.progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{loading.progress < 1 ? `${Math.round(loading.progress * 100)}%` : "Its picture, its sound and where the cuts are"}</p>
          </div>
        ) : (
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-muted">
              <Clapperboard className="size-6" strokeWidth={1.5} />
            </span>
            <h2 className="mt-5 font-display text-[32px] leading-tight font-light tracking-[-0.03em] sm:text-[40px]">Drop a video</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-pretty text-muted-foreground">
              Its cuts appear on the timeline. Lay voice, music and effects against the picture, then export the mix or the video with its new audio.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={props.onPick}>
                <Upload strokeWidth={1.5} /> Choose a video
              </Button>
              <Button onClick={props.onAudioOnly}>
                <AudioLines strokeWidth={1.5} /> Start without video
              </Button>
            </div>
            <p className={cn("mx-auto mt-5 max-w-sm text-xs text-pretty", props.error ? "text-danger" : "text-muted-foreground")}>
              {props.error ?? "MP4, MOV, WebM, MKV. ProRes, HEVC and other camera codecs get a small preview copy; the export keeps your original picture."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
