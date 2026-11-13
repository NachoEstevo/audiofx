export type Track = "original" | "processed";

/** RMS in dB of a buffer, ignoring silence (50 ms blocks below -60 dBFS). */
function activeRmsDb(buffer: AudioBuffer): number {
  const block = Math.round(buffer.sampleRate * 0.05);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let sum = 0;
  let count = 0;
  for (let start = 0; start < buffer.length; start += block) {
    const end = Math.min(buffer.length, start + block);
    let s = 0;
    for (const ch of channels) for (let i = start; i < end; i += 2) s += ch[i] * ch[i];
    const n = (Math.ceil((end - start) / 2) * channels.length) || 1;
    if (s / n > 1e-6) {
      sum += s;
      count += n;
    }
  }
  return count ? 10 * Math.log10(sum / count) : -120;
}

/**
 * Sample peak in dBFS (not true peak: inter-sample overs need oversampling) and how many samples sit at
 * full scale. Renders are 16-bit, so an over becomes a run of samples clipped at ±1: that count is the
 * honest "it clips" signal, where a peak threshold would flag any source already mastered to -0.1 dB.
 */
function samplePeak(buffer: AudioBuffer): { db: number; clipped: number } {
  let peak = 0;
  let clipped = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
      if (v >= 0.9999) clipped++;
    }
  }
  return { db: peak > 0 ? 20 * Math.log10(peak) : -120, clipped };
}

/** Seconds to ease from one render into the next while playing. */
const SWAP_FADE = 0.25;
/** Seconds to cross between original and processed: short, so the comparison stays immediate but does not click. */
const TOGGLE_FADE = 0.03;

/**
 * A/B player: switches between original and processed while keeping the position.
 * With `matchLoudness` the processed track plays at the original's level, like the plugins'
 * "gain match", so you judge the character and not the volume.
 */
export class Player {
  readonly ctx = new AudioContext({ sampleRate: 48000 });
  readonly analyser = this.ctx.createAnalyser();
  private readonly gain = this.ctx.createGain();
  private buffers: Partial<Record<Track, AudioBuffer>> = {};
  private levels: Partial<Record<Track, number>> = {};
  private peaks: Partial<Record<Track, { db: number; clipped: number }>> = {};
  private node?: AudioBufferSourceNode;
  /** Fade gain of the playing source: each source has its own, so two can cross over. */
  private fader?: GainNode;
  private startedAt = 0;
  private offset = 0;
  track: Track = "processed";
  playing = false;
  loop = true;
  matchLoudness = false;
  onChange?: () => void;
  private listeners = new Set<() => void>();

  constructor() {
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.8;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /** Listens to changes besides `onChange` (the screen's own): the header logo follows the active screen's player. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private changed() {
    this.onChange?.();
    for (const fn of this.listeners) fn();
  }

  async load(track: Track, data: ArrayBuffer) {
    const buffer = await this.ctx.decodeAudioData(data);
    this.setBuffer(track, buffer);
    return buffer;
  }

  /** Loads an already decoded buffer (e.g. from the render cache). */
  setBuffer(track: Track, buffer: AudioBuffer) {
    this.buffers[track] = buffer;
    this.levels[track] = activeRmsDb(buffer);
    this.peaks[track] = samplePeak(buffer);
    this.applyGain();
    if (this.playing && track === this.track) this.restart();
    this.changed();
  }

  /** Buffer of the active track; the original while there is no processed one yet. */
  buffer(track: Track = this.track) {
    return this.buffers[track] ?? this.buffers.original;
  }

  /** The exact buffer of a track, without falling back to the original. */
  peek(track: Track) {
    return this.buffers[track];
  }

  clear() {
    this.stop();
    this.playing = false;
    this.buffers = {};
    this.levels = {};
    this.peaks = {};
    this.offset = 0;
    this.changed();
  }

  dropProcessed() {
    delete this.buffers.processed;
    delete this.levels.processed;
    delete this.peaks.processed;
    this.applyGain();
    if (this.playing && this.track === "processed") this.restart();
    this.changed();
  }

  get duration() {
    return this.buffer()?.duration ?? 0;
  }

  private scope?: Float32Array;

  /** Level of what is playing now (0–1, roughly -48 to 0 dBFS) to animate the orb. */
  level(): number {
    if (!this.playing) return 0;
    if (!this.scope || this.scope.length !== this.analyser.fftSize) this.scope = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.scope);
    let s = 0;
    for (let i = 0; i < this.scope.length; i += 4) s += this.scope[i] * this.scope[i];
    const db = 10 * Math.log10((s / (this.scope.length / 4)) + 1e-10);
    return Math.max(0, Math.min(1, (db + 48) / 42));
  }

  /** Level difference processed − original in dB (null when a track is missing). */
  get levelDiffDb(): number | null {
    const { original, processed } = this.levels;
    return original === undefined || processed === undefined ? null : processed - original;
  }

  /** Sample peak of a track in dBFS and its count of full-scale samples (undefined while not loaded). */
  peak(track: Track): { db: number; clipped: number } | undefined {
    return this.peaks[track];
  }

  /** A few full-scale samples happen in loud masters; a run of them, more than the original had, is clipping. */
  get clipping(): boolean {
    const processed = this.peaks.processed;
    return !!processed && processed.clipped > Math.max(8, (this.peaks.original?.clipped ?? 0) * 1.5);
  }

  get time() {
    if (!this.playing) return this.offset;
    const t = this.offset + this.ctx.currentTime - this.startedAt;
    return this.loop && this.duration ? t % this.duration : Math.min(t, this.duration);
  }

  setMatchLoudness(on: boolean) {
    this.matchLoudness = on;
    this.applyGain();
    this.changed();
  }

  setLoop(on: boolean) {
    const at = this.time;
    this.loop = on;
    this.offset = at;
    if (this.playing) this.restart();
    this.changed();
  }

  private applyGain() {
    const diff = this.levelDiffDb;
    const db = this.matchLoudness && this.track === "processed" && diff !== null ? Math.max(-18, Math.min(18, -diff)) : 0;
    this.gain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.015);
  }

  /** Stops what is playing; with `fade` seconds it fades out first, so a new source can cross over it. */
  private stop(fade = 0) {
    const node = this.node;
    const out = this.fader;
    if (!node || !out) return;
    this.node = undefined;
    this.fader = undefined;
    node.onended = null;
    if (fade > 0) {
      const now = this.ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + fade);
      node.stop(now + fade);
      node.onended = () => {
        node.disconnect();
        out.disconnect();
      };
    } else {
      node.stop();
      node.disconnect();
      out.disconnect();
    }
  }

  /** A new render or loop setting while playing: eases from what was sounding into the new one. */
  private restart() {
    const at = this.time;
    this.stop(SWAP_FADE);
    this.startAt(at, SWAP_FADE);
  }

  private startAt(at: number, fade = 0) {
    const buffer = this.buffer();
    if (!buffer) return;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = this.loop;
    const fader = this.ctx.createGain();
    if (fade > 0) {
      fader.gain.setValueAtTime(0, this.ctx.currentTime);
      fader.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fade);
    }
    node.connect(fader);
    fader.connect(this.gain);
    this.fader = fader;
    const offset = Math.min(at, Math.max(0, buffer.duration - 0.01));
    node.start(0, offset);
    node.onended = () => {
      if (this.node !== node) return;
      this.playing = false;
      this.offset = 0;
      this.changed();
    };
    this.node = node;
    this.offset = offset;
    this.startedAt = this.ctx.currentTime;
  }

  async play() {
    if (!this.buffer()) return;
    await this.ctx.resume();
    this.stop();
    this.startAt(this.offset);
    this.playing = true;
    this.changed();
  }

  pause() {
    this.offset = this.time;
    this.stop();
    this.playing = false;
    this.changed();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    this.offset = Math.max(0, t);
    if (this.playing) {
      this.stop();
      this.startAt(this.offset);
    }
    this.changed();
  }

  setTrack(track: Track) {
    if (track === this.track) return;
    const at = this.time;
    this.track = track;
    this.offset = at;
    this.applyGain();
    if (this.playing) {
      this.stop(TOGGLE_FADE);
      this.startAt(at, TOGGLE_FADE);
    }
    this.changed();
  }
}
