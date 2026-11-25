/** Client-safe rules for the audible-delay test: pause-aware cuts and strictly ordered playback. */
import { PCM_SAMPLE_RATE, PIECE_SECONDS } from "@/lib/deepgram";

export const MIN_PAUSE_SECONDS = 0.3;
export const CUT_WINDOW_SECONDS = 2;
export const EXTEND_SECONDS = 4;
export const MAX_PIECE_SECONDS = PIECE_SECONDS + EXTEND_SECONDS;
export const SPEED_MIN = 1;
export const SPEED_MAX = 1.2;
export const DEFAULT_SPEED: Readonly<Record<"fr" | "es", number>> = { fr: 1.1, es: 1 };
export const clampSpeed = (v: number) => Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(v) ? v : 1)) * 100) / 100;
/** Adaptive playback: speed up while the playback backlog is large, return to base once it has cleared. */
export const AUTO_FAST_SPEED = 1.15;
export const BACKLOG_ON_SECONDS = 5;
export const BACKLOG_OFF_SECONDS = 2;
export function nextFast(backlogSeconds: number, fast: boolean): boolean {
  if (backlogSeconds > BACKLOG_ON_SECONDS) return true;
  if (backlogSeconds < BACKLOG_OFF_SECONDS) return false;
  return fast;
}
export const speedFor = (base: number, fast: boolean) => (fast ? Math.max(base, AUTO_FAST_SPEED) : base);
/** Seconds of live audio each visitor may use per UTC day on the public landing-page demo. */
export const DEMO_LIMIT_SECONDS = 180;
export const PIECE_TIMEOUT_MS = 30000;
const FRAME_SECONDS = 0.01;

/** pause: ≥300 ms pause within ±2 s of 8 s · extended: next pause within 4 s after 8 s · forced: hard cut at 8 s. */
export type CutType = "pause" | "extended" | "forced";
export type Cut = { index: number; startSeconds: number; endSeconds: number; type: CutType };

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

export type CutRule = { target: number; window: number; extend: number };
export const CUT_RULE: CutRule = { target: PIECE_SECONDS, window: CUT_WINDOW_SECONDS, extend: EXTEND_SECONDS };

/** Silent stretches of at least 300 ms, relative to the clip's own loudness. */
export function findPauses(samples: Float32Array, rate = PCM_SAMPLE_RATE) {
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
  return pauses.filter((p) => p.end - p.start >= MIN_PAUSE_SECONDS - 1e-9);
}

/**
 * Live version of the same cut rule, decided as early as possible on a growing microphone buffer
 * (seconds since the current piece began). Returns null while it must keep listening.
 */
export function nextLiveCut(samples: Float32Array, rate = PCM_SAMPLE_RATE, rule: CutRule = CUT_RULE): { endSeconds: number; type: CutType } | null {
  const PIECE_SECONDS = rule.target, CUT_WINDOW_SECONDS = rule.window, EXTEND_SECONDS = rule.extend, MAX_PIECE_SECONDS = rule.target + rule.extend;
  const total = samples.length / rate;
  if (total < PIECE_SECONDS - CUT_WINDOW_SECONDS) return null;
  // Only pauses that have finished (speech resumed) have a settled centre.
  const centres = findPauses(samples, rate).filter((p) => p.end < total - 1e-6).map((p) => (p.start + p.end) / 2);
  const near = centres.filter((c) => Math.abs(c - PIECE_SECONDS) <= CUT_WINDOW_SECONDS);
  const nearest = near.reduce<number | null>((b, c) => (b === null || Math.abs(c - PIECE_SECONDS) < Math.abs(b - PIECE_SECONDS) ? c : b), null);
  const round = (v: number) => Math.round(v * 100) / 100;
  if (nearest !== null && (nearest >= PIECE_SECONDS || total >= PIECE_SECONDS + CUT_WINDOW_SECONDS)) return { endSeconds: round(nearest), type: "pause" };
  if (total < PIECE_SECONDS + CUT_WINDOW_SECONDS) return null;
  const ext = centres.find((c) => c > PIECE_SECONDS + CUT_WINDOW_SECONDS && c <= PIECE_SECONDS + EXTEND_SECONDS);
  if (ext !== undefined) return { endSeconds: round(ext), type: "extended" };
  if (total >= MAX_PIECE_SECONDS) return { endSeconds: PIECE_SECONDS, type: "forced" };
  return null;
}

/** Cuts near every 8 s at a ≥300 ms pause within ±2 s; else extends to the next pause within 4 s; else forces 8 s. */
export function findCuts(samples: Float32Array, rate = PCM_SAMPLE_RATE, rule: CutRule = CUT_RULE): Cut[] {
  const PIECE_SECONDS = rule.target, CUT_WINDOW_SECONDS = rule.window, EXTEND_SECONDS = rule.extend, MAX_PIECE_SECONDS = rule.target + rule.extend;
  const total = samples.length / rate;
  const long = findPauses(samples, rate);

  const cuts: Cut[] = [];
  let start = 0;
  while (total - start > MAX_PIECE_SECONDS) {
    const target = start + PIECE_SECONDS;
    let best: number | null = null;
    let extended: number | null = null;
    for (const p of long) {
      const centre = (p.start + p.end) / 2;
      if (Math.abs(centre - target) <= CUT_WINDOW_SECONDS && (best === null || Math.abs(centre - target) < Math.abs(best - target))) best = centre;
      if (centre > target + CUT_WINDOW_SECONDS && centre <= target + EXTEND_SECONDS && (extended === null || centre < extended)) extended = centre;
    }
    const type: CutType = best !== null ? "pause" : extended !== null ? "extended" : "forced";
    const end = Math.round((best ?? extended ?? target) * 100) / 100;
    cuts.push({ index: cuts.length, startSeconds: start, endSeconds: end, type });
    start = end;
  }
  if (total - start > 0) cuts.push({ index: cuts.length, startSeconds: start, endSeconds: Math.round(total * 100) / 100, type: "pause" });
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

/** Average/min/max per stretch: first 3 minutes, the middle, and the last 3 minutes of speech. */
export function sectionStats(rows: { speechStartSeconds: number; delayMs: number }[], totalSeconds: number) {
  const edge = Math.min(180, totalSeconds / 3);
  const pick = (f: (t: number) => boolean) => delayStats(rows.filter((r) => f(r.speechStartSeconds)).map((r) => r.delayMs));
  return {
    first: pick((t) => t < edge),
    middle: pick((t) => t >= edge && t < totalSeconds - edge),
    last: pick((t) => t >= totalSeconds - edge),
  };
}

/** Linear extrapolation of the start→end change to one hour of speech. */
export const growthPerHourMs = (changeMs: number, totalSeconds: number) => (totalSeconds > 0 ? Math.round((changeMs / totalSeconds) * 3600) : 0);
export const lengthPercent = (audioSeconds: number, speechSeconds: number) => (speechSeconds > 0 ? Math.round((audioSeconds / speechSeconds) * 1000) / 10 : 0);

export type ReviewRow = { language: string; piece: number; cutType: CutType; english: string; translation: string; mark: "" | "acceptable" | "not acceptable" };
const csvCell = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function reviewCsv(rows: ReviewRow[]) {
  const head = ["language", "piece", "cut_type", "english", "translation", "review"];
  return [head, ...rows.map((r) => [r.language, r.piece, r.cutType, r.english, r.translation, r.mark])].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A dropped provider connection (not a rejection or timeout). */
export const isDroppedConnection = (message: string) => /ECONNRESET|socket connection was closed|connection failed|closed before finalising|fetch failed|network/i.test(message);

/** Runs `fn`; on a dropped connection tries exactly once more, reporting the retry. */
export async function withOneRetry<T>(fn: () => Promise<T>, onRetry: (message: string) => void): Promise<T> {
  try { return await fn(); }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isDroppedConnection(message)) throw e;
    onRetry(message);
    return await fn();
  }
}
