import { ChevronDown, ChevronUp, Power, RotateCcw, X } from "lucide-react";
import { getEffect } from "../../../src/core/registry";
import type { EffectStep, ParamSpec, ParamValue } from "../../../src/core/types";
import { CATEGORY_ICONS } from "@/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Step = EffectStep & { key: string; windowed: boolean; bypassed: boolean };
export type SampleOption = { id: string; name: string; folder: string };

export function StepCard(props: {
  step: Step;
  index: number;
  total: number;
  duration: number;
  /** Moment marked on the waveform, to anchor time params. */
  moment: number;
  /** Library samples a file param can pick from. */
  samples: SampleOption[];
  /** Text of the button that takes `moment` (default "Use the moment"). */
  momentLabel?: string;
  onParam: (id: string, value: ParamValue) => void;
  onUpdate: (patch: Partial<Step>) => void;
  onMove: (delta: number) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const { step, index, total, duration } = props;
  const effect = getEffect(step.effect);
  const Icon = CATEGORY_ICONS[effect.category];
  return (
    <article className={cn("animate-rise rounded-3xl bg-card p-5 shadow-ring transition-opacity", step.bypassed && "opacity-55")}>
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[15px] font-medium">{effect.name}</h3>
            <span className="font-mono text-[11px] text-muted-foreground">
              {String(index + 1).padStart(2, "0")} · {effect.id}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{effect.whenToUse}</p>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center">
          <Button size="icon-sm" variant="ghost" onClick={() => props.onMove(-1)} disabled={index === 0} aria-label="Move up" title="Move up">
            <ChevronUp strokeWidth={1.5} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => props.onMove(1)} disabled={index === total - 1} aria-label="Move down" title="Move down">
            <ChevronDown strokeWidth={1.5} />
          </Button>
          <Button
            size="icon-sm"
            variant={step.bypassed ? "primary" : "ghost"}
            onClick={() => props.onUpdate({ bypassed: !step.bypassed })}
            aria-pressed={step.bypassed}
            aria-label="Bypass"
            title={step.bypassed ? "Bypassed: tap to turn it back on" : "Bypass: hear the chain without this step"}
          >
            <Power strokeWidth={1.5} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={props.onReset} aria-label="Reset params" title="Reset">
            <RotateCcw strokeWidth={1.5} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={props.onRemove} aria-label="Remove from chain" title="Remove">
            <X strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      {effect.params.length > 0 && (
        <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {effect.params.map((spec) => (
            <ParamControl
              key={spec.id}
              spec={spec}
              value={step.params?.[spec.id] ?? spec.default}
              moment={props.moment}
              momentLabel={props.momentLabel}
              samples={props.samples}
              onChange={(v) => props.onParam(spec.id, v)}
            />
          ))}
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-[13px]">
        {effect.timed ? (
          <span className="text-muted-foreground">Happens at a moment: set it above or tap “{props.momentLabel ?? "Use the moment"}”.</span>
        ) : effect.changesDuration ? (
          <span className="text-muted-foreground">Changes the duration: applies to the whole audio.</span>
        ) : (
          <>
            <Switch checked={step.windowed} onChange={(on) => props.onUpdate({ windowed: on })} label="Only between" />
            <NumberField value={step.from ?? 0} min={0} max={duration} disabled={!step.windowed} onChange={(v) => props.onUpdate({ from: v })} label="From" />
            <span className="text-muted-foreground">and</span>
            <NumberField value={step.to ?? 0} min={0} max={duration + 10} disabled={!step.windowed} onChange={(v) => props.onUpdate({ to: v })} label="To" />
            <span className="text-muted-foreground">fade</span>
            <NumberField value={step.fade ?? 0.25} min={0} max={5} disabled={!step.windowed} onChange={(v) => props.onUpdate({ fade: v })} label="Fade" />
            <span className="flex-1" />
            <label className="flex w-full items-center gap-3 sm:w-48">
              <span className="text-muted-foreground">Mix</span>
              <Slider value={step.mix ?? 1} min={0} max={1} step={0.01} onChange={(v) => props.onUpdate({ mix: v })} label="Dry/wet mix" />
              <span className="w-9 text-right font-mono text-xs tabular-nums">{Math.round((step.mix ?? 1) * 100)}%</span>
            </label>
          </>
        )}
      </footer>
    </article>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 cursor-pointer rounded-full transition-colors", checked ? "bg-foreground" : "bg-muted-strong")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
      </button>
      {label}
    </label>
  );
}

function NumberField(props: { value: number; min: number; max: number; label: string; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <span className={cn("inline-flex h-8 items-center rounded-full bg-muted px-3 font-mono text-xs", props.disabled && "opacity-40")}>
      <input
        className="w-12 bg-transparent text-right tabular-nums outline-none"
        type="number"
        step={0.05}
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) props.onChange(v);
        }}
      />
      <span className="ml-0.5 text-muted-foreground">s</span>
    </span>
  );
}

function Slider(props: { value: number; min: number; max: number; step: number; label: string; onChange: (v: number) => void; onReset?: () => void }) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <input
      className="slider flex-1"
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      aria-label={props.label}
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
      onChange={(e) => props.onChange(Number(e.target.value))}
      onDoubleClick={props.onReset}
    />
  );
}

/** A native select dressed as a pill: the system picker is the right control on a phone. */
export function SamplePicker(props: { value: string; samples: SampleOption[]; label: string; empty?: string; onChange: (id: string) => void }) {
  const known = !props.value || props.samples.some((s) => s.id === props.value);
  return (
    <span className="relative inline-flex h-9 max-w-full min-w-0 flex-1 items-center rounded-full bg-muted text-[13px] transition-colors hover:bg-muted-strong">
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent pr-8 pl-3.5 outline-none focus-visible:shadow-[0_0_0_2px_var(--color-foreground)]"
      >
        {props.empty !== undefined && <option value="">{props.empty}</option>}
        {!known && <option value={props.value}>Missing sample</option>}
        {props.samples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.folder}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-3.5" strokeWidth={1.5} />
    </span>
  );
}

/** One param's control, by its spec: slider (log for frequencies), time field with "Use the moment", choices, switch or sample. */
export function ParamControl({
  spec,
  value,
  moment,
  momentLabel = "Use the moment",
  samples,
  onChange,
}: {
  spec: ParamSpec;
  value: ParamValue;
  moment: number;
  momentLabel?: string;
  samples: SampleOption[];
  onChange: (v: ParamValue) => void;
}) {
  if (spec.type === "file") {
    return (
      <div className="min-w-0 sm:col-span-2" title={spec.description}>
        <span className="mb-1.5 block text-[13px] text-muted-foreground">{spec.label}</span>
        <SamplePicker
          label={spec.label}
          value={String(value).replace(/^library:/, "")}
          samples={samples}
          empty={String(value) ? undefined : "Pick a sample"}
          onChange={(id) => onChange(id ? `library:${id}` : "")}
        />
      </div>
    );
  }
  // Params that are an instant in the audio (at, start): a number field and a button to take the marked moment.
  if (spec.type === "number" && spec.unit === "s" && spec.max >= 60) {
    return (
      <div className="block" title={spec.description}>
        <span className="mb-1 block text-[13px] text-muted-foreground">{spec.label}</span>
        <span className="flex items-center gap-2">
          <NumberField value={Number(value)} min={spec.min} max={spec.max} label={spec.label} onChange={onChange} />
          {spec.moment !== false && (
            <Button size="sm" variant="ghost" onClick={() => onChange(Math.round(moment * 100) / 100)}>
              {momentLabel}
            </Button>
          )}
        </span>
      </div>
    );
  }
  if (spec.type === "enum") {
    return (
      <div className="sm:col-span-2" title={spec.description}>
        <span className="mb-1.5 block text-[13px] text-muted-foreground">{spec.label}</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={spec.label}>
          {spec.options.map((o) => (
            <button
              key={o}
              role="radio"
              aria-checked={String(value) === o}
              onClick={() => onChange(o)}
              className={cn(
                "h-7 cursor-pointer rounded-full px-3 text-[13px] transition-colors",
                String(value) === o ? "bg-foreground text-white" : "bg-muted hover:bg-muted-strong",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (spec.type === "bool") {
    return (
      <div className="flex items-center text-[13px]" title={spec.description}>
        <Switch checked={Boolean(value)} onChange={onChange} label={spec.label} />
      </div>
    );
  }
  const v = Number(value);
  const log = spec.scale === "log";
  const toSlider = (x: number) => (log ? (Math.log(x / spec.min) / Math.log(spec.max / spec.min)) * 1000 : x);
  const fromSlider = (s: number) => {
    if (!log) return s;
    const x = spec.min * Math.pow(spec.max / spec.min, s / 1000);
    return Math.round(x * (x < 100 ? 10 : 1)) / (x < 100 ? 10 : 1);
  };
  const step = spec.step ?? (spec.max - spec.min > 50 ? 1 : 0.01);
  const shown = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : Number(v.toFixed(step < 1 ? 2 : 0)).toString();
  return (
    <label className="block" title={spec.description ? `${spec.description} (double-click: default)` : "Double-click: default"}>
      <span className="mb-0.5 flex items-baseline justify-between text-[13px]">
        <span className="text-muted-foreground">{spec.label}</span>
        <span className="font-mono text-xs tabular-nums">
          {shown}
          {spec.unit && <span className="ml-0.5 text-muted-foreground">{spec.unit}</span>}
        </span>
      </span>
      <Slider
        value={toSlider(v)}
        min={log ? 0 : spec.min}
        max={log ? 1000 : spec.max}
        step={log ? 1 : step}
        label={spec.label}
        onChange={(s) => onChange(fromSlider(s))}
        onReset={() => onChange(spec.default)}
      />
    </label>
  );
}
