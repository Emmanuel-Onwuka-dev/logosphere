/** Client-safe rules for the audible-delay test: pause-aware cuts and strictly ordered playback. */
import { PCM_SAMPLE_RATE, PIECE_SECONDS } from "@/lib/deepgram";

export const MIN_PAUSE_SECONDS = 0.3;
export const CUT_WINDOW_SECONDS = 2;
export const MAX_PIECE_SECONDS = PIECE_SECONDS + CUT_WINDOW_SECONDS;
export const PIECE_TIMEOUT_MS = 30000;
const FRAME_SECONDS = 0.01;

export type Cut = { index: number; startSeconds: number; endSeconds: number; atPause: boolean };

function frameLevels(samples: Float32Array, rate: number) {
  const size = Math.round(rate * FRAME_SECONDS);
  const levels: number[] = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0;
    for (let j = i; j < i + size; j++) { const s = samples[j] ?? 0; sum += s * s; }
    levels.push(Math.sqrt(sum / size));
  }
  return levels;
}

/** Cuts near every 8 s at the centre of a ≥300 ms pause within ±2 s, else exactly at the 8 s mark. */
export function findCuts(samples: Float32Array, rate = PCM_SAMPLE_RATE): Cut[] {
  const total = samples.length / rate;
  const levels = frameLevels(samples, rate);
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const threshold = Math.max(0.003, Math.min(floor * 2, loud * 0.1));
  const pauses: { start: number; end: number }[] = [];
  let run = -1;
  levels.forEach((level, i) => {
    if (level < threshold) { if (run < 0) run = i; }
    else if (run >= 0) { pauses.push({ start: run * FRAME_SECONDS, end: i * FRAME_SECONDS }); run = -1; }
  });
  if (run >= 0) pauses.push({ start: run * FRAME_SECONDS, end: levels.length * FRAME_SECONDS });
  const long = pauses.filter((p) => p.end - p.start >= MIN_PAUSE_SECONDS - 1e-9);

  const cuts: Cut[] = [];
  let start = 0;
  while (total - start > MAX_PIECE_SECONDS) {
    const target = start + PIECE_SECONDS;
    let best: number | null = null;
    for (const p of long) {
      const centre = (p.start + p.end) / 2;
      if (Math.abs(centre - target) <= CUT_WINDOW_SECONDS && (best === null || Math.abs(centre - target) < Math.abs(best - target))) best = centre;
    }
    const end = Math.round((best ?? target) * 100) / 100;
    cuts.push({ index: cuts.length, startSeconds: start, endSeconds: end, atPause: best !== null });
    start = end;
  }
  if (total - start > 0) cuts.push({ index: cuts.length, startSeconds: start, endSeconds: Math.round(total * 100) / 100, atPause: false });
  return cuts;
}

export type Ready = { index: number; readyMs: number; audioSeconds: number; failed: boolean };
export type Slot = Ready & { playStartMs: number; playEndMs: number };

/**
 * Plays in number order only: a piece starts at max(its arrival, previous piece's end),
 * so nothing skips ahead, overlaps or cuts off. Failed pieces arrive as silence of the piece length.
 */
export function schedulePlayback(ready: Ready[]): Slot[] {
  const byIndex = [...ready].sort((a, b) => a.index - b.index);
  let end = -Infinity;
  return byIndex.map((r, i) => {
    if (r.index !== i) throw new Error(`Piece ${i + 1} is missing`);
    const playStartMs = Math.max(r.readyMs, end);
    end = playStartMs + r.audioSeconds * 1000;
    return { ...r, playStartMs, playEndMs: end };
  });
}

export function delayStats(delaysMs: number[]) {
  if (!delaysMs.length) return null;
  const avg = delaysMs.reduce((a, b) => a + b, 0) / delaysMs.length;
  const edge = Math.max(1, Math.min(3, Math.floor(delaysMs.length / 4)));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    averageMs: Math.round(avg), minMs: Math.min(...delaysMs), maxMs: Math.max(...delaysMs),
    changeMs: Math.round(mean(delaysMs.slice(-edge)) - mean(delaysMs.slice(0, edge))),
  };
}

export function wavSeconds(wav: Uint8Array) {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  // Streamed WAVs may carry a placeholder data size, so measure the actual bytes.
  return (wav.length - 44) / (v.getUint32(24, true) * v.getUint16(22, true) * (v.getUint16(34, true) / 8));
}
