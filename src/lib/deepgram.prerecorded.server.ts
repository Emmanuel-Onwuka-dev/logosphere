import { PIECE_TIMEOUT_MS } from "@/lib/interpretation";

export type TimedSegment = { start: number; end: number; text: string };

/**
 * Deepgram prerecorded transcription of a file the service can fetch by link (for example a short-lived storage URL).
 * The audio never passes through the Worker. Returns timed utterances in order.
 */
export async function deepgramTranscribeUrl(url: string, key: string, language: "en" = "en") {
  const params = new URLSearchParams({ model: "nova-3", language, smart_format: "true", utterances: "true", punctuate: "true" });
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(Math.max(PIECE_TIMEOUT_MS, 240_000)),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`Deepgram transcription failed (HTTP ${response.status}); check the key, model access and balance`);
  const json = (await response.json()) as {
    metadata?: { duration?: number };
    results?: { utterances?: { start: number; end: number; transcript: string }[] };
  };
  const segments: TimedSegment[] = (json.results?.utterances ?? [])
    .map((u) => ({ start: Number(u.start), end: Number(u.end), text: (u.transcript ?? "").trim() }))
    .filter((s) => s.text.length > 0 && s.end > s.start);
  return { durationSeconds: Number(json.metadata?.duration ?? 0), segments };
}
