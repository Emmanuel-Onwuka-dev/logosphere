/** Client-safe contracts only. Provider calls and credentials live in *.server.ts. */
export const DEEPGRAM_STT_LANGUAGES = ["en", "fr", "es", "pt"] as const;
export const DEEPGRAM_VOICES: Readonly<Record<string, string>> = {
  en: "aura-2-thalia-en", fr: "aura-2-agathe-fr", es: "aura-2-celeste-es",
};
export const CLIP_LIMIT_SECONDS = 120;
export const CONTINUOUS_LIMIT_SECONDS = 180;
export const PIECE_SECONDS = 8;
export const PCM_SAMPLE_RATE = 16000;
export const DEFAULT_SOURCE = "en";
export const DEFAULT_TARGET = "fr";

export function validateDuration(seconds: number, mode: "clip" | "piece" | "interpret" | "continuous") {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("The audio is empty or unreadable");
  if (mode === "clip" && seconds >= CLIP_LIMIT_SECONDS) throw new Error("Clips must be under 2 minutes");
  if (mode === "piece" && seconds > PIECE_SECONDS + 1 / PCM_SAMPLE_RATE) throw new Error("A streaming piece must be at most 8 seconds");
  if (mode === "interpret" && seconds > PIECE_SECONDS + 2 + 1 / PCM_SAMPLE_RATE) throw new Error("An interpreted piece must be at most 10 seconds");
  if (mode === "continuous" && seconds > CONTINUOUS_LIMIT_SECONDS) throw new Error("Continuous tests accept up to 3 minutes");
}

export function encodeWav(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, out.length - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  });
  return out;
}

export function readPcmWav(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (i: number) => String.fromCharCode(...wav.subarray(i, i + 4));
  if (wav.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("A PCM WAV recording is required");
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== PCM_SAMPLE_RATE || view.getUint16(34, true) !== 16 || tag(36) !== "data") {
    throw new Error("Audio must be 16-bit mono PCM at 16 kHz");
  }
  const size = view.getUint32(40, true);
  if (size === 0 || size % 2 !== 0 || size !== wav.length - 44) throw new Error("Invalid WAV audio length");
  return { pcm: wav.subarray(44), durationSeconds: size / (PCM_SAMPLE_RATE * 2) };
}

export function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export type PieceResult = {
  index: number; startSeconds: number; durationSeconds: number; transcript: string;
  firstPartialMs: number | null; finalTextMs: number | null; displayDelayMs: number | null; error: string | null;
  completed: boolean;
};

/** Least-squares drift across actual displayed text. Short/incomplete tests stay inconclusive. */
export function delayTrend(rows: PieceResult[], durationSeconds: number) {
  const measured = rows.filter((r) => r.displayDelayMs !== null && !r.error);
  if (durationSeconds < 179 || rows.some((r) => r.error || !r.completed) || rows.length < Math.ceil(durationSeconds / PIECE_SECONDS) || measured.length < 3) return { verdict: "incomplete" as const, growthMs: null };
  const xMean = measured.reduce((n, r) => n + r.startSeconds, 0) / measured.length;
  const yMean = measured.reduce((n, r) => n + (r.displayDelayMs ?? 0), 0) / measured.length;
  const denominator = measured.reduce((n, r) => n + (r.startSeconds - xMean) ** 2, 0);
  const slope = denominator ? measured.reduce((n, r) => n + (r.startSeconds - xMean) * ((r.displayDelayMs ?? 0) - yMean), 0) / denominator : 0;
  const growthMs = Math.round(slope * durationSeconds);
  return { verdict: growthMs > 1000 ? "growing" as const : "stable" as const, growthMs };
}

export function splitSpeechText(text: string): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > 2000) {
    const window = rest.slice(0, 2000);
    const split = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf(" "));
    const end = split > 0 ? split + 1 : 2000;
    pieces.push(rest.slice(0, end).trim()); rest = rest.slice(end).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Aura-2's PCM WAV responses use the standard 44-byte header. */
export function joinSpeechWav(parts: Uint8Array[]) {
  const first = parts[0];
  if (!first) throw new Error("No speech audio was returned");
  if (parts.length === 1) return first;
  const valid = parts.every((part) => part.length > 44 && String.fromCharCode(...part.subarray(36, 40)) === "data" && part.subarray(20, 36).every((b, i) => b === first[20 + i]));
  if (!valid) throw new Error("The speech audio format could not be joined");
  const length = parts.reduce((n, part) => n + part.length - 44, 44);
  const output = new Uint8Array(length); output.set(first.subarray(0, 44));
  const view = new DataView(output.buffer); view.setUint32(4, length - 8, true); view.setUint32(40, length - 44, true);
  let offset = 44;
  for (const part of parts) { output.set(part.subarray(44), offset); offset += part.length - 44; }
  return output;
}