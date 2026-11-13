export * from "./types.js";
export { compile, parseStep, type CompiledGraph } from "./compile.js";
export { EFFECTS, catalog, describeEffect, getEffect, resolveParams, type EffectInfo } from "./registry.js";
export { analyzeFile, applyToBuffer, applyToFile, decodeFloat32, measureSync, resolveFfmpeg, runFfmpeg, syncPoints, type Analysis, type SyncPoints } from "./ffmpeg.js";
export { LIBRARY_REF } from "./effects/layer.js";
export { prepareSteps, type PrepareOptions } from "./prepare.js";
export { detectCuts, probeMedia, type Cut, type MediaInfo } from "./media.js";
export {
  DEFAULT_CEILING,
  DEFAULT_LOUDNESS,
  DUCK_DEFAULTS,
  compileMix,
  projectDuration,
  validateMix,
  type CompiledMix,
  type DuckOptions,
  type MixClip,
  type MixMaster,
  type MixProject,
  type MixSource,
  type MixSources,
  type MixTrack,
  type TrackRole,
} from "./mix.js";
export { prepareMix, renderMix, type MixRender, type PrepareMixOptions, type PreparedMix } from "./mix-run.js";
