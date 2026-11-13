/** Working sample rate for the whole pipeline. Matches video renders (48 kHz). */
export const SAMPLE_RATE = 48000;

export type Category =
  | "cinema"
  | "filter"
  | "space"
  | "era"
  | "modulation"
  | "character"
  | "narrative"
  | "transition"
  | "dynamics";

export const CATEGORY_LABELS: Record<Category, string> = {
  cinema: "Cinema & trailer",
  filter: "Filters & EQ",
  space: "Spaces",
  era: "Era & medium",
  modulation: "Modulation",
  character: "Voices & characters",
  narrative: "Narrative",
  transition: "Transitions",
  dynamics: "Dynamics & mix",
};

export interface NumberParam {
  type: "number";
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  unit?: string;
  /** Suggested slider scale: "log" for frequencies. */
  scale?: "linear" | "log";
  /** false for a time that is not an instant on the timeline (a length, an offset inside a sample): the studio then offers no "Use the moment". */
  moment?: boolean;
  description?: string;
}

export interface EnumParam {
  type: "enum";
  id: string;
  label: string;
  options: readonly string[];
  default: string;
  description?: string;
}

export interface BoolParam {
  type: "bool";
  id: string;
  label: string;
  default: boolean;
  description?: string;
}

/**
 * An audio file on disk (a sample to layer). The value is a path, or a `library:<id>` reference that the
 * CLI and the studio server resolve before compiling: the browser never sees paths.
 */
export interface FileParam {
  type: "file";
  id: string;
  label: string;
  default: string;
  description?: string;
}

export type ParamSpec = NumberParam | EnumParam | BoolParam | FileParam;
export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

/** Context each effect receives when it is compiled into a graph. */
export interface BuildContext {
  /** Input label, e.g. "s0" (used as [s0]). */
  input: string;
  /** Output label the effect must produce. */
  output: string;
  /** Creates internal labels that are unique across the whole graph. */
  label(hint: string): string;
  /** Seed for noise and impulse responses; makes renders reproducible. */
  seed: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: Category;
  /** What it does, in one sentence. */
  description: string;
  /** When to use it in a video. Agents read this to choose. */
  whenToUse: string;
  tags: string[];
  params: ParamSpec[];
  /**
   * true if it changes the duration (speed, reverse with tail, etc.).
   * Those effects cannot be applied to a time window.
   */
  changesDuration?: boolean;
  /** true if it adds a tail (reverb, echo): the compiler can pad silence at the end. */
  hasTail?: boolean;
  /**
   * true if the effect happens at a moment: it is anchored with the `at` param (seconds), e.g. a hit on a
   * cut. It does not use a from/to window: the effect itself decides which stretch it touches.
   */
  timed?: boolean;
  /** Returns one or more filtergraph chains, from [ctx.input] to [ctx.output]. */
  build(p: Params, ctx: BuildContext): string;
}

/** One step of a chain: which effect, with which params and, optionally, in which window. */
export interface EffectStep {
  effect: string;
  params?: Params;
  /** Window start in seconds; if omitted, the effect covers the whole audio. */
  from?: number;
  /** Window end in seconds. */
  to?: number;
  /** Crossfade length in seconds between dry and processed at the window edges. */
  fade?: number;
  /** Processed proportion (0–1). Defaults to 1. */
  mix?: number;
}

export interface CompileOptions {
  /** Seconds of silence added at the end so reverb and echo tails are not cut. */
  tail?: number;
  seed?: number;
  /** Adds aresample/aformat at the start to normalize to 48 kHz stereo. Defaults to true. */
  normalize?: boolean;
  /**
   * Prefix for every label and named filter instance (`bandpass@<prefix>...`) of the graph, so several
   * compiled chains can live in one `-filter_complex` without colliding. Defaults to none.
   */
  labelPrefix?: string;
}
