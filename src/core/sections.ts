import { analyzeFile, runFfmpeg } from "./ffmpeg.js";

/**
 * Where a track changes: the strongest rises in level (drop candidates), the strongest falls (breakdowns,
 * endings) and the sections between them. An agent cannot listen to a song, so this gives it numbers to
 * propose a drop with; the user confirms by ear.
 *
 * Measured on the mono downmix in 5 ms blocks, with two curves:
 * - loudness: K-weighted power (ITU-R BS.1770), in LUFS;
 * - low band: power below 150 Hz (4th-order Butterworth), where the kick and the bass usually enter.
 * The jump at second t is the level of the `SECTION_WINDOW` seconds after t minus the same before (at least
 * `MIN_SIDE` on each side, so changes near the ends count). The low band's jump is the smaller of that and
 * the same over `LOW_SHORT` seconds: a riser leading into a drop smears the 3 s jump over the build-up,
 * and a bass line with rests swings the 1 s one; only where the bass enters and stays are both large. It
 * is 0 where the low band is not a real part of the sound (`LOW_PRESENCE`).
 * A rise or fall is ranked by its jump plus half its low-band jump in the same direction, and needs a
 * score of `MIN_SCORE` dB. Its time is then snapped to the nearest sharp edge in the same direction (a rise
 * to an attack such as a kick or a hit, a fall to a cut-off), so it can be used for sync.
 */

/** Seconds compared on each side of a change. */
export const SECTION_WINDOW = 3;
const LOW_SHORT = 1;
const BLOCK = 0.005;
const MIN_SIDE = 1;
/** Rises (and falls) closer than this are one change: the strongest is kept. More than SECTION_WINDOW, so a big change's shoulders are not reported as changes of their own. */
const SPACING = 4;
const LOW_CUTOFF = 150;
const LOW_WEIGHT = 0.5;
/** dB: the low band counts when, on its louder side, it is within this of the whole. */
const LOW_PRESENCE = 20;
/** dB: a jump of 3 dB, or 6 dB below 150 Hz with a flat overall level, is a change; a steady loop moves under 1 dB. */
const MIN_SCORE = 3;
/** Levels are clamped this many dB below the loudest stretch, so silence and noise floors do not make huge jumps. */
const FLOOR_DB = 50;
/** A sharp edge is searched this far around a change. */
const EDGE_RADIUS = 0.3;
/** dB: how far a 5 ms block must rise (or fall) from the previous 50 ms, overall plus low band, to be an edge. */
const EDGE_MIN = 10;
/** Edges at least this share of the strongest one nearby compete; the nearest wins. */
const EDGE_SHARE = 0.6;
/** Seconds: sections shorter than this (a gap before a drop) are not reported as the quietest or loudest. */
const MIN_STRETCH = 2;
/** Rate the track is decoded at: plenty for loudness and attacks, half the data of 48 kHz. */
const ANALYSIS_RATE = 24000;

export interface LevelChange {
  /** Second of the change, snapped to the nearest sharp edge (an attack for a rise, a cut-off for a fall) when there is one. */
  time: number;
  /** dB: level of the `window` seconds after `time` minus the `window` seconds before (negative for a fall). */
  jump: number;
  /**
   * dB: the same below 150 Hz, the smaller of the jumps over 1 s and over `window` s on each side. Large only
   * where the bass or the kick enters (or leaves) and stays: a drop usually shows it.
   */
  lowJump: number;
  /** LUFS of the stretch before and after. */
  before: number;
  after: number;
  /** true when `time` was snapped to a sharp edge; false for a gradual change, whose time is approximate. */
  sharp: boolean;
}

export interface TrackSection {
  start: number;
  end: number;
  /** LUFS (ungated mean). */
  level: number;
  /** dBFS RMS below 150 Hz. */
  low: number;
}

export interface TrackSections {
  /** Seconds. */
  duration: number;
  /** Integrated loudness in LUFS (null for silence). */
  integrated: number | null;
  /** Seconds compared on each side of a change. */
  window: number;
  /** The strongest rises, strongest first: the drop candidates. */
  rises: LevelChange[];
  /** The strongest falls, strongest first: breakdowns and endings. */
  falls: LevelChange[];
  /** The track cut at every reported rise and fall, in order. */
  sections: TrackSection[];
  /** The quietest and loudest sections at least 2 s long (null for silence). */
  quietest: TrackSection | null;
  loudest: TrackSection | null;
}

export interface SectionOptions {
  /** How many rises and falls to report. Default 5. */
  top?: number;
  /**
   * The file's integrated loudness measured on all its channels (`analyzeFile`). The mono downmix reads
   * a few dB off it, depending on the stereo image; with this, every level is shifted to match.
   */
  integrated?: number | null;
}

type Coeffs = readonly [b0: number, b1: number, b2: number, a1: number, a2: number];

function biquad([b0, b1, b2, a1, a2]: Coeffs) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x: number) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** BS.1770 K-weighting at any rate (the coefficients libebur128 derives): a +4 dB shelf above ~1.7 kHz and a 38 Hz highpass. */
function kWeighting(rate: number): [Coeffs, Coeffs] {
  let K = Math.tan((Math.PI * 1681.974450955533) / rate);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Coeffs = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan((Math.PI * 38.13547087602444) / rate);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  return [shelf, [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]];
}

/** RBJ lowpass biquad. */
function lowpass(freq: number, q: number, rate: number): Coeffs {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** Prefix sums, so the mean of any run of blocks costs two reads. */
function prefix(values: Float64Array): Float64Array {
  const sums = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) sums[i + 1] = sums[i] + values[i];
  return sums;
}

const meanOf = (sums: Float64Array, from: number, to: number) => (to > from ? (sums[to] - sums[from]) / (to - from) : 0);
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Integrated loudness (BS.1770: 400 ms blocks every 100 ms, gated at -70 LUFS and 10 LU below the mean). */
function integratedOf(sums: Float64Array, blocks: number, blockSeconds: number): number | null {
  const size = Math.round(0.4 / blockSeconds);
  const hop = Math.round(0.1 / blockSeconds);
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const powers: number[] = [];
  for (let i = 0; i + size <= blocks; i += hop) {
    const p = meanOf(sums, i, i + size);
    if (p > 0 && lufs(p) > -70) powers.push(p);
  }
  if (!powers.length) return null;
  const gate = lufs(powers.reduce((a, b) => a + b, 0) / powers.length) - 10;
  const kept = powers.filter((p) => lufs(p) > gate);
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** Analyzes a mono signal (pure: no disk, no ffmpeg). */
export function trackSections(samples: Float32Array, rate: number, options: SectionOptions = {}): TrackSections {
  const top = options.top ?? 5;
  if (!Number.isInteger(top) || top < 1) throw new Error("top must be a whole number of 1 or more.");
  const duration = samples.length / rate;
  const size = Math.max(1, Math.round(rate * BLOCK));
  const blockSeconds = size / rate;
  const count = Math.floor(samples.length / size);

  // Block powers: K-weighted (loudness) and below 150 Hz.
  const [shelf, rlb] = kWeighting(rate);
  const kShelf = biquad(shelf);
  const kHigh = biquad(rlb);
  const low1 = biquad(lowpass(LOW_CUTOFF, 0.5411961, rate));
  const low2 = biquad(lowpass(LOW_CUTOFF, 1.3065630, rate));
  const kPow = new Float64Array(count);
  const lowPow = new Float64Array(count);
  for (let b = 0; b < count; b++) {
    let k = 0;
    let l = 0;
    for (let j = b * size; j < (b + 1) * size; j++) {
      const x = samples[j];
      const kx = kHigh(kShelf(x));
      const lx = low2(low1(x));
      k += kx * kx;
      l += lx * lx;
    }
    kPow[b] = k / size;
    lowPow[b] = l / size;
  }
  const K = prefix(kPow);
  const L = prefix(lowPow);

  const window = Math.round(SECTION_WINDOW / blockSeconds);
  let loudest = 0;
  for (let i = 0; i < count; i += Math.max(1, Math.round(0.1 / blockSeconds))) loudest = Math.max(loudest, meanOf(K, i, Math.min(count, i + window)));
  const own = integratedOf(K, count, blockSeconds);
  const empty: TrackSections = { duration: round(duration, 3), integrated: null, window: SECTION_WINDOW, rises: [], falls: [], sections: [], quietest: null, loudest: null };
  if (!(loudest > 0) || own === null) return empty;

  const floor = loudest * Math.pow(10, -FLOOR_DB / 10);
  const offset = options.integrated != null && Number.isFinite(options.integrated) ? options.integrated - own : 0;
  const db = (p: number) => 10 * Math.log10(Math.max(p, floor));
  const lufs = (p: number) => -0.691 + db(p) + offset;

  // The change at every block boundary.
  const side = Math.round(MIN_SIDE / blockSeconds);
  const short = Math.round(LOW_SHORT / blockSeconds);
  const jump = new Float64Array(count + 1).fill(NaN);
  const lowJump = new Float64Array(count + 1).fill(NaN);
  const levelsAt = (i: number) => {
    const a = Math.max(0, i - window);
    const b = Math.min(count, i + window);
    return { a, b, before: meanOf(K, a, i), after: meanOf(K, i, b) };
  };
  for (let i = side; i <= count - side; i++) {
    const { a, b, before, after } = levelsAt(i);
    jump[i] = db(after) - db(before);
    const [lowBefore, lowAfter] = [meanOf(L, a, i), meanOf(L, i, b)];
    // The low band counts only where it is a real part of the sound: a lone low tick in a passage with
    // no bass would otherwise swing its near-empty level by many dB.
    const weighty = db(Math.max(lowBefore, lowAfter)) >= db(lowAfter >= lowBefore ? after : before) - LOW_PRESENCE;
    const long = db(lowAfter) - db(lowBefore);
    const near = db(meanOf(L, i, i + short)) - db(meanOf(L, i - short, i));
    // Both scales must agree: the one closer to 0 (0 when they disagree on the direction).
    lowJump[i] = weighty && Math.sign(long) === Math.sign(near) ? Math.sign(long) * Math.min(Math.abs(long), Math.abs(near)) : 0;
  }

  /**
   * How sharply the level rises (sign 1) or falls (sign -1) at block i, overall plus below 150 Hz, against
   * the 50 ms before: for a rise the 5 ms block itself, so it peaks where an attack starts; for a fall the
   * 50 ms after, so it peaks where a sound stops (single blocks of a quiet passage ripple too much).
   */
  const span = Math.round(0.05 / blockSeconds);
  const edge = (i: number, sign: 1 | -1) => {
    const a = Math.max(0, i - span);
    const b = Math.min(count, i + span);
    if (i <= a || b <= i) return 0;
    const [k, l] = sign > 0 ? [kPow[i], lowPow[i]] : [meanOf(K, i, b), meanOf(L, i, b)];
    return Math.max(0, sign * (db(k) - db(meanOf(K, a, i)))) + Math.max(0, sign * (db(l) - db(meanOf(L, a, i))));
  };
  /** The strongest edges in the change's direction near block c (peaks at least 25 ms apart) compete; the nearest to c wins. */
  const snap = (c: number, sign: 1 | -1): { index: number; sharp: boolean } => {
    const radius = Math.round(EDGE_RADIUS / blockSeconds);
    const apart = Math.round(0.025 / blockSeconds);
    const from = Math.max(0, c - radius - apart);
    const strength = new Float64Array(2 * (radius + apart) + 1);
    const at = (i: number) => strength[i - from];
    for (let i = from; i < from + strength.length && i <= count; i++) strength[i - from] = edge(i, sign);
    let best = 0;
    let strongest = c;
    for (let i = Math.max(0, c - radius); i <= Math.min(count, c + radius); i++) if (at(i) > best) [best, strongest] = [at(i), i];
    if (best < EDGE_MIN) return { index: c, sharp: false };
    let index = strongest;
    for (let i = Math.max(0, c - radius); i <= Math.min(count, c + radius); i++) {
      if (at(i) < EDGE_SHARE * best || Math.abs(i - c) >= Math.abs(index - c)) continue;
      let peak = true;
      for (let j = Math.max(from, i - apart); j <= Math.min(from + strength.length - 1, i + apart) && peak; j++) peak = at(j) <= at(i);
      if (peak) index = i;
    }
    return { index, sharp: true };
  };

  const pick = (sign: 1 | -1): LevelChange[] => {
    const score = (i: number) => sign * jump[i] + LOW_WEIGHT * Math.max(0, sign * lowJump[i]);
    const order: number[] = [];
    for (let i = side; i <= count - side; i++) if (score(i) >= MIN_SCORE) order.push(i);
    order.sort((x, y) => score(y) - score(x));
    const spacing = Math.round(SPACING / blockSeconds);
    const picked: number[] = [];
    for (const i of order) {
      if (picked.length >= top) break;
      if (picked.every((p) => Math.abs(p - i) >= spacing)) picked.push(i);
    }
    return picked.map((coarse) => {
      const snapped = snap(coarse, sign);
      // Snapping can move the change past the margin at the ends: then the coarse measurement stands.
      const i = Number.isNaN(jump[snapped.index]) ? coarse : snapped.index;
      const { before, after } = levelsAt(i);
      return {
        time: round(snapped.index * blockSeconds, 3),
        jump: round(jump[i], 1),
        lowJump: round(lowJump[i], 1),
        before: round(lufs(before), 1),
        after: round(lufs(after), 1),
        sharp: snapped.sharp,
      };
    });
  };
  const rises = pick(1);
  const falls = pick(-1);

  // Sections between the reported changes.
  const minGap = Math.round(0.25 / blockSeconds);
  const cuts = [...rises, ...falls].map((c) => Math.round(c.time / blockSeconds)).sort((x, y) => x - y);
  const edges = [0];
  for (const c of cuts) if (c - edges[edges.length - 1] >= minGap && count - c >= minGap) edges.push(c);
  edges.push(count);
  const sections: TrackSection[] = edges.slice(0, -1).map((start, i) => ({
    start: round(start * blockSeconds, 3),
    end: round(i === edges.length - 2 ? duration : edges[i + 1] * blockSeconds, 3),
    level: round(lufs(meanOf(K, start, edges[i + 1])), 1),
    low: round(db(meanOf(L, start, edges[i + 1])), 1),
  }));
  const long = sections.filter((s) => s.end - s.start >= MIN_STRETCH);
  const pool = long.length ? long : sections;
  const by = (better: (a: number, b: number) => boolean) => pool.reduce((x, y) => (better(y.level, x.level) ? y : x));

  return {
    duration: round(duration, 3),
    integrated: round(own + offset, 1),
    window: SECTION_WINDOW,
    rises,
    falls,
    sections,
    quietest: by((a, b) => a < b),
    loudest: by((a, b) => a > b),
  };
}

/**
 * Decodes a file's audio (mono, 24 kHz) and finds its rises, falls and sections. Levels are calibrated to
 * the file's integrated loudness as `sfx analyze` measures it.
 */
export async function measureSections(file: string, options: Omit<SectionOptions, "integrated"> = {}): Promise<TrackSections> {
  const decode = runFfmpeg(["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "-"]).catch((error: Error) => {
    if (/does not contain any stream|matches no streams/.test(error.message)) throw new Error(`${file} has no audio.`);
    throw error;
  });
  const [{ stdout }, analysis] = await Promise.all([decode, analyzeFile(file)]);
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  return trackSections(samples, ANALYSIS_RATE, { ...options, integrated: analysis.integratedLufs });
}
