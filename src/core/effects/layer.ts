import { filterPath, mixInto, n } from "../graph.js";
import { SAMPLE_RATE, type EffectDefinition, type Params } from "../types.js";

/**
 * Real recordings as layers: a sample from a library, a generation or any local file, mixed into the
 * signal at an exact second. The file is read inside the filtergraph with `amovie`, so the chain still
 * has one input and works with `ffmpeg -af`.
 */

const num = (p: Params, k: string) => p[k] as number;

/** Prefix of a file reference that points at the local library instead of a path. */
export const LIBRARY_REF = "library:";

export const layerEffects: EffectDefinition[] = [
  {
    id: "layer",
    name: "Sample layer",
    category: "cinema",
    description: "Mixes an audio file (a recorded sample, a generation, any local file) into the signal at an exact second.",
    whenToUse:
      "When a recorded sound beats a synthesized one: a real impact on the cut, a door, glass, a whoosh, an ambience bed. Use align=onset so the sample's attack, not its leading silence, lands on `at`.",
    tags: ["sample", "layer", "sfx", "foley", "recorded", "epidemic", "elevenlabs", "mix"],
    timed: true,
    hasTail: true,
    params: [
      {
        type: "file",
        id: "file",
        label: "Sample",
        default: "",
        description: "Path to the audio file, or library:<id> for a file in the AudioFX library (`sfx sample list`).",
      },
      {
        type: "number",
        id: "at",
        label: "Moment",
        min: 0,
        max: 600,
        default: 1,
        unit: "s",
        step: 0.01,
        description: "Second of the audio where the sample's sync point lands. In the studio it comes from the moment marker.",
      },
      { type: "number", id: "level", label: "Level", min: -60, max: 12, default: 0, unit: "dB", step: 0.5 },
      {
        type: "enum",
        id: "align",
        label: "Align",
        options: ["start", "onset", "peak"],
        default: "start",
        description:
          "What lands on the moment: the file's start (plus `sync`), its measured attack (onset) or its loudest point (peak, for whooshes). onset and peak are measured from the file when rendering and replace `sync`.",
      },
      {
        type: "number",
        id: "sync",
        label: "Sync point",
        min: 0,
        max: 600,
        default: 0,
        unit: "s",
        step: 0.001,
        moment: false,
        description: "Second inside the sample that lands on the moment. Whatever comes before it plays earlier.",
      },
      {
        type: "number",
        id: "length",
        label: "Length",
        min: 0,
        max: 600,
        default: 0,
        unit: "s",
        step: 0.05,
        moment: false,
        description: "Use only this much of the sample, from its start. 0 = the whole file.",
      },
      { type: "number", id: "fadeIn", label: "Fade in", min: 0, max: 10, default: 0, unit: "s", step: 0.01 },
      { type: "number", id: "fadeOut", label: "Fade out", min: 0, max: 10, default: 0, unit: "s", step: 0.01 },
    ],
    build: (p, ctx) => {
      const file = String(p.file ?? "");
      if (!file) throw new Error("layer: give the sample to mix in (file=<path> or file=library:<id>).");
      const at = num(p, "at");
      const sync = num(p, "sync");
      const length = num(p, "length");
      // The sample starts `sync` seconds before the moment. If that is before 0, its head is trimmed instead.
      const delay = Math.max(0, at - sync);
      const skip = Math.max(0, sync - at);
      if (length > 0 && length <= skip) throw new Error("layer: `length` ends before the sync point reaches the start of the audio.");
      const filters = [`aresample=${SAMPLE_RATE}`, "aformat=sample_fmts=fltp:channel_layouts=stereo"];
      if (skip > 0 || length > 0) {
        filters.push(`atrim=start=${n(skip)}${length > 0 ? `:end=${n(length)}` : ""}`, "asetpts=PTS-STARTPTS");
      }
      if (num(p, "fadeIn") > 0) filters.push(`afade=t=in:st=0:d=${n(num(p, "fadeIn"))}`);
      if (num(p, "fadeOut") > 0) {
        // The sample's duration is not known when compiling: fade its end by fading the reversed signal in.
        filters.push("areverse", `afade=t=in:st=0:d=${n(num(p, "fadeOut"))}`, "areverse");
      }
      filters.push(`volume=${n(num(p, "level"))}dB`, `adelay=delays=${n(delay * 1000, 3)}:all=1`);
      const placed = ctx.label("smp");
      return [`amovie=filename=${filterPath(file)},${filters.join(",")}[${placed}]`, mixInto(ctx.input, placed, ctx.output)].join(";");
    },
  },
];
