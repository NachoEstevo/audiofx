/**
 * Fluid Orb — adapted from Rare UI (https://rareui.com/components/fluidorb), components/ui/fluid-orb.tsx.
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution:
 * may be used and modified inside an application with visible credit to https://rareui.com; the component
 * may not be sold or redistributed on its own. Full text: https://github.com/swamimalode07/rare-ui
 *
 * Changes: reacts to the audio level (`getLevel`, 0–1) by speeding up the drift and spreading the color,
 * the color changes with a smooth transition instead of recreating the WebGL context, and the shader is
 * exposed as `createOrbRenderer` so one context can paint many small orbs (see orb-swatch.tsx).
 */
import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type FluidOrbProps = ComponentProps<"div"> & {
  size?: number;
  color?: string;
  /** Current audio level (0–1); read every frame. */
  getLevel?: () => number;
};

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_level;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  // With a high level the color rises higher and the turbulence shows more.
  float g = clamp(1.0 - uv.y + u_level * 0.35, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * (0.8 + u_level * 0.6) * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 dark = u_color;

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`;

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0.1, 0.45, 0.95];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface OrbRenderer {
  /** Draws one frame filling a px × px viewport at the bottom-left of the canvas. */
  draw(px: number, time: number, level: number, color: readonly number[]): void;
  dispose(): void;
}

export function createOrbRenderer(gl: WebGLRenderingContext): OrbRenderer | null {
  const program = gl.createProgram();
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!program || !vert || !frag) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, "u_resolution");
  const uTime = gl.getUniformLocation(program, "u_time");
  const uLevel = gl.getUniformLocation(program, "u_level");
  const uColor = gl.getUniformLocation(program, "u_color");

  return {
    draw(px, time, level, color) {
      gl.viewport(0, 0, px, px);
      gl.uniform2f(uResolution, px, px);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uLevel, level);
      gl.uniform3f(uColor, color[0], color[1], color[2]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    },
  };
}

export function FluidOrb({ size = 240, color = "#1A73F2", getLevel, className, style, ...props }: FluidOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(hexToRgb(color));
  const levelRef = useRef(getLevel);
  colorRef.current = hexToRgb(color);
  levelRef.current = getLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return;
    const orb = createOrbRenderer(gl);
    if (!orb) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const current = [...colorRef.current];
    let phase = 0;
    let level = 0;
    let last = performance.now();
    let raf = 0;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Fast attack and slow release, like a VU meter.
      const target = Math.min(1, Math.max(0, levelRef.current?.() ?? 0));
      level += (target - level) * (target > level ? 0.35 : 0.06);
      phase += dt * (0.22 + level * 1.4);
      for (let i = 0; i < 3; i++) current[i] += (colorRef.current[i] - current[i]) * 0.08;
      orb.draw(px, reduce ? 0 : phase, reduce ? 0 : level, current);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      orb.dispose();
    };
  }, [size]);

  return (
    <div
      data-slot="fluid-orb"
      className={cn("relative overflow-hidden rounded-full", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
