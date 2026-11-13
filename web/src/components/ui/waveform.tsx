/**
 * Waveform y AudioScrubber adaptados de ElevenLabs UI (https://github.com/elevenlabs/ui),
 * apps/www/registry/elevenlabs-ui/ui/waveform.tsx.
 *
 * MIT License — Copyright (c) 2025 Eleven Labs Inc.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
 * notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * Changes: the height reaches the canvas, played bars are painted with `progressColor` over the
 * pending ones (instead of a translucent layer), highlighted regions were added, and dragging uses
 * pointer events (mouse and touch).
 */
import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type WaveformProps = HTMLAttributes<HTMLDivElement> & {
  data?: number[];
  barWidth?: number;
  barHeight?: number;
  barGap?: number;
  barRadius?: number;
  barColor?: string;
  /** Color of the bars left of `progress` (0–1). */
  progressColor?: string;
  progress?: number;
  fadeEdges?: boolean;
  fadeWidth?: number;
  height?: string | number;
  onBarClick?: (index: number, value: number) => void;
};

export const Waveform = ({
  data = [],
  barWidth = 3,
  barHeight: baseBarHeight = 2,
  barGap = 2,
  barRadius = 2,
  barColor,
  progressColor,
  progress = 0,
  fadeEdges = true,
  fadeWidth = 24,
  height = 128,
  onBarClick,
  className,
  ...props
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const render = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const styles = getComputedStyle(canvas);
      // Canvas does not resolve var(--x): read the custom property from the element.
      const resolve = (color: string | undefined, fallbackVar: string, fallback: string) => {
        const name = color?.match(/^var\((--[\w-]+)\)$/)?.[1];
        return (name ? styles.getPropertyValue(name).trim() : color) || styles.getPropertyValue(fallbackVar).trim() || fallback;
      };
      const base = resolve(barColor, "--wave", "#c9c6c1");
      const played = resolve(progressColor, "--foreground", "#000");
      const barCount = Math.floor(rect.width / (barWidth + barGap));
      const centerY = rect.height / 2;

      for (let i = 0; i < barCount; i++) {
        const value = data[Math.floor((i / barCount) * data.length)] || 0;
        const h = Math.max(baseBarHeight, value * rect.height * 0.9);
        const x = i * (barWidth + barGap);
        ctx.fillStyle = x / rect.width < progress ? played : base;
        ctx.beginPath();
        ctx.roundRect(x, centerY - h / 2, barWidth, h, barRadius);
        ctx.fill();
      }

      if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
        const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
        const fade = Math.min(0.2, fadeWidth / rect.width);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(fade, "rgba(255,255,255,0)");
        gradient.addColorStop(1 - fade, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(255,255,255,1)");
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.globalCompositeOperation = "source-over";
      }
    };

    const observer = new ResizeObserver(render);
    observer.observe(container);
    render();
    return () => observer.disconnect();
  }, [data, barWidth, baseBarHeight, barGap, barRadius, barColor, progressColor, progress, fadeEdges, fadeWidth]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onBarClick) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const barIndex = Math.floor((e.clientX - rect.left) / (barWidth + barGap));
    const dataIndex = Math.floor((barIndex * data.length) / Math.floor(rect.width / (barWidth + barGap)));
    if (dataIndex >= 0 && dataIndex < data.length) onBarClick(dataIndex, data[dataIndex]);
  };

  return (
    <div className={cn("relative", className)} ref={containerRef} style={{ height: heightStyle }} {...props}>
      <canvas className="block h-full w-full" onClick={handleClick} ref={canvasRef} />
    </div>
  );
};

export type AudioScrubberProps = WaveformProps & {
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  showHandle?: boolean;
  /** Highlighted regions in seconds (e.g. an effect window). */
  regions?: { from: number; to: number; label?: string }[];
};

export const AudioScrubber = ({
  data = [],
  currentTime = 0,
  duration = 100,
  onSeek,
  showHandle = true,
  regions = [],
  barWidth = 3,
  barHeight,
  barGap = 2,
  barRadius = 2,
  barColor,
  progressColor,
  height = 128,
  className,
  ...props
}: AudioScrubberProps) => {
  const [dragging, setDragging] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging && duration > 0) setLocalProgress(Math.min(1, currentTime / duration));
  }, [currentTime, duration, dragging]);

  const scrub = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const progress = Math.max(0, Math.min(clientX - rect.left, rect.width)) / rect.width;
      setLocalProgress(progress);
      onSeek?.(progress * duration);
    },
    [duration, onSeek],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => scrub(e.clientX);
    const up = () => setDragging(false);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [dragging, scrub]);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      aria-label="Audio timeline"
      aria-valuemax={duration}
      aria-valuemin={0}
      aria-valuenow={currentTime}
      className={cn("relative cursor-pointer touch-none select-none", className)}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        scrub(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek?.(Math.min(duration, currentTime + 1));
        if (e.key === "ArrowLeft") onSeek?.(Math.max(0, currentTime - 1));
      }}
      ref={containerRef}
      role="slider"
      style={{ height: heightStyle }}
      tabIndex={0}
      {...props}
    >
      {regions.map((r, i) => (
        <div
          key={i}
          className="pointer-events-none absolute inset-y-0 rounded-md bg-[var(--region)]"
          style={{ left: `${(r.from / duration) * 100}%`, width: `${(Math.max(0, r.to - r.from) / duration) * 100}%` }}
        >
          {r.label && <span className="absolute left-1.5 top-1 text-[10px] font-medium text-[var(--muted-foreground)]">{r.label}</span>}
        </div>
      ))}
      <Waveform
        barColor={barColor}
        progressColor={progressColor}
        progress={localProgress}
        barGap={barGap}
        barRadius={barRadius}
        barWidth={barWidth}
        barHeight={barHeight}
        data={data}
        fadeEdges={false}
        height={height}
      />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-[var(--foreground)]" style={{ left: `${localProgress * 100}%` }} />
      {showHandle && (
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--foreground)] shadow"
          style={{ left: `${localProgress * 100}%` }}
        />
      )}
    </div>
  );
};
