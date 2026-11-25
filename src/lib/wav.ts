/** 16-bit mono PCM WAV at any sample rate. Used for downloads; the live pipeline keeps using encodeWav. */
export function encodeWavAt(samples: Float32Array, rate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Places decoded clips on one timeline at their start times. Overlaps keep the earlier clip's samples. */
export function placeClips(clips: { start: number; samples: Float32Array; rate: number }[], rate: number): Float32Array {
  const total = clips.reduce((n, c) => Math.max(n, Math.round(c.start * rate) + Math.round((c.samples.length / c.rate) * rate)), 0);
  const out = new Float32Array(total);
  for (const c of clips) {
    const offset = Math.round(c.start * rate);
    const resampledLength = Math.round((c.samples.length / c.rate) * rate);
    for (let i = 0; i < resampledLength; i++) {
      const src = Math.min(c.samples.length - 1, Math.floor((i * c.rate) / rate));
      if (offset + i < out.length) out[offset + i] = c.samples[src] ?? 0;
    }
  }
  return out;
}
