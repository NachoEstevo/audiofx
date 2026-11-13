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
  private startedAt = 0;
  private offset = 0;
  track: Track = "processed";
  playing = false;
  loop = true;
  matchLoudness = false;
  onChange?: () => void;

  constructor() {
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.8;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
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
    this.onChange?.();
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
    this.onChange?.();
  }

  dropProcessed() {
    delete this.buffers.processed;
    delete this.levels.processed;
    delete this.peaks.processed;
    this.applyGain();
    if (this.playing && this.track === "processed") this.restart();
    this.onChange?.();
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

  get time() {
    if (!this.playing) return this.offset;
    const t = this.offset + this.ctx.currentTime - this.startedAt;
    return this.loop && this.duration ? t % this.duration : Math.min(t, this.duration);
  }

  setMatchLoudness(on: boolean) {
    this.matchLoudness = on;
    this.applyGain();
    this.onChange?.();
  }

  setLoop(on: boolean) {
    const at = this.time;
    this.loop = on;
    this.offset = at;
    if (this.playing) this.restart();
    this.onChange?.();
  }

  private applyGain() {
    const diff = this.levelDiffDb;
    const db = this.matchLoudness && this.track === "processed" && diff !== null ? Math.max(-18, Math.min(18, -diff)) : 0;
    this.gain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.015);
  }

  private stop() {
    if (this.node) {
      this.node.onended = null;
      this.node.stop();
      this.node.disconnect();
      this.node = undefined;
    }
  }

  private restart() {
    const at = this.time;
    this.stop();
    this.startAt(at);
  }

  private startAt(at: number) {
    const buffer = this.buffer();
    if (!buffer) return;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = this.loop;
    node.connect(this.gain);
    const offset = Math.min(at, Math.max(0, buffer.duration - 0.01));
    node.start(0, offset);
    node.onended = () => {
      if (this.node !== node) return;
      this.playing = false;
      this.offset = 0;
      this.onChange?.();
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
    this.onChange?.();
  }

  pause() {
    this.offset = this.time;
    this.stop();
    this.playing = false;
    this.onChange?.();
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
    this.onChange?.();
  }

  setTrack(track: Track) {
    if (track === this.track) return;
    const at = this.time;
    this.track = track;
    this.offset = at;
    this.applyGain();
    if (this.playing) {
      this.stop();
      this.startAt(at);
    }
    this.onChange?.();
  }
}
