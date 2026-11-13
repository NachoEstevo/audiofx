/** Just under full scale: only a real over is touched, a master sitting at -0.1 dB is not. */
const CEILING = 0.98;
const LOOKAHEAD_S = 0.005;
const RELEASE_S = 0.08;

/**
 * A copy of a render that the speakers can play without clipping: a look-ahead peak limiter, the same gain on
 * every channel. Renders arrive as float, so an over is still there to measure; this only protects the
 * preview. Returns the buffer itself when nothing goes over.
 */
export function safeForPlayback(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const length = buffer.length;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  // The gain each sample needs on its own.
  const need = new Float32Array(length).fill(1);
  let over = false;
  for (const ch of channels) {
    for (let i = 0; i < length; i++) {
      const v = Math.abs(ch[i]);
      if (v > CEILING) {
        over = true;
        const g = CEILING / v;
        if (g < need[i]) need[i] = g;
      }
    }
  }
  if (!over) return buffer;

  // Lowest need over the next L samples, then its mean over the last L: a ramp that is already down when the
  // peak arrives and never sits above what any sample needs.
  const L = Math.max(1, Math.round(LOOKAHEAD_S * buffer.sampleRate));
  const ahead = new Float32Array(length);
  const queue = new Int32Array(length);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < length; i++) {
    const end = Math.min(length - 1, i + L);
    for (; next <= end; next++) {
      while (tail > head && need[queue[tail - 1]] >= need[next]) tail--;
      queue[tail++] = next;
    }
    while (queue[head] < i) head++;
    ahead[i] = need[queue[head]];
  }
  const release = 1 - Math.exp(-1 / (RELEASE_S * buffer.sampleRate));
  const gain = need; // reused: `need` is not read again
  let sum = 0;
  let g = 1;
  for (let i = 0; i < length; i++) {
    sum += ahead[i];
    if (i > L) sum -= ahead[i - L - 1];
    const mean = sum / Math.min(i + 1, L + 1);
    // Down with the ramp, back up slowly: a fast recovery would ride the bass.
    g = Math.min(mean, g + (1 - g) * release);
    gain[i] = g;
  }

  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  channels.forEach((ch, c) => {
    const to = out.getChannelData(c);
    for (let i = 0; i < length; i++) to[i] = ch[i] * gain[i];
  });
  return out;
}
