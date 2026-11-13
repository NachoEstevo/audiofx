/** A frame at 24 fps: the sync tolerance the catalog's tests hold every effect to. */
export const FRAME_24 = 1 / 24;

/**
 * Second where the sound starts: the first 5 ms block above 25% of the loudest one (1/16 of its energy),
 * over all channels. The same rule as `syncPoints` in src/core/ffmpeg.ts, on a decoded AudioBuffer.
 */
export function onsetSeconds(buffer: AudioBuffer): number {
  const block = Math.round(buffer.sampleRate * 0.005);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const energy: number[] = [];
  let max = 0;
  for (let start = 0; start + block <= buffer.length; start += block) {
    let s = 0;
    for (const ch of channels) for (let i = start; i < start + block; i++) s += ch[i] * ch[i];
    energy.push(s);
    if (s > max) max = s;
  }
  if (max <= 0) return 0;
  return (energy.findIndex((e) => e > max / 16) * block) / buffer.sampleRate;
}
