import { describe, expect, it, vi, afterEach } from "vitest";
import { ACTIVE_TARGET_LANGUAGES, SOURCE_LANGUAGES, TARGET_LANGUAGES } from "@/lib/languages";
import { CLIP_LIMIT_SECONDS, CONTINUOUS_LIMIT_SECONDS, DEFAULT_SOURCE, DEFAULT_TARGET, DEEPGRAM_STT_LANGUAGES, DEEPGRAM_VOICES, PIECE_SECONDS, PCM_SAMPLE_RATE, delayTrend, encodeWav, readPcmWav, validateDuration, splitSpeechText, joinSpeechWav, type PieceResult } from "@/lib/deepgram";
import { isDeepgramEndpoint, isEngineSecretName } from "@/lib/engine-secrets";
import { deepgramSpeak, deepgramTranscribe } from "@/lib/deepgram.server";

afterEach(() => vi.unstubAllGlobals());

describe("requested language scope", () => {
  it("keeps English as the only preacher source", () => expect(SOURCE_LANGUAGES.map((l) => l.code)).toEqual(["en"]));
  it("uses French Spanish and Portuguese as active targets", () => expect(ACTIVE_TARGET_LANGUAGES.map((l) => l.code)).toEqual(["fr", "es", "pt"]));
  it("defaults From to English", () => expect(DEFAULT_SOURCE).toBe("en"));
  it("defaults To to French", () => expect(DEFAULT_TARGET).toBe("fr"));
  it("retains each Nigerian target paused", () => expect(TARGET_LANGUAGES.filter((l) => ["ha", "yo", "ig"].includes(l.code)).map((l) => [l.code, l.status])).toEqual([["ig", "paused"], ["yo", "paused"], ["ha", "paused"]]));
  it("registers Nova-3 with en/fr/es/pt", () => expect([...DEEPGRAM_STT_LANGUAGES]).toEqual(["en", "fr", "es", "pt"]));
  it("does not offer a Portuguese Aura-2 voice", async () => {
    expect(DEEPGRAM_VOICES["pt"]).toBeUndefined();
    const call = vi.fn(); vi.stubGlobal("fetch", call);
    await expect(deepgramSpeak("Bom dia", "pt", "test-key")).rejects.toThrow(/Portuguese/);
    expect(call).not.toHaveBeenCalled();
  });
  it("accepts only secret names, including the requested Deepgram name", () => {
    expect(isEngineSecretName("DEEPGRAM_API_KEY")).toBe(true);
    expect(isEngineSecretName("ENGINE_INTRON_API_KEY")).toBe(true);
    expect(isEngineSecretName("raw-key-value")).toBe(false);
  });
  it("does not mistake an unrelated host for Deepgram", () => {
    expect(isDeepgramEndpoint("https://api.deepgram.com/v1/listen")).toBe(true);
    expect(isDeepgramEndpoint("https://api.deepgram.com.evil.example")).toBe(false);
  });
});

describe("audio test limits", () => {
  it("requires short clips under two minutes", () => {
    expect(CLIP_LIMIT_SECONDS).toBe(120);
    expect(() => validateDuration(119.99, "clip")).not.toThrow();
    expect(() => validateDuration(120, "clip")).toThrow();
  });
  it("accepts a three-minute continuous file", () => {
    expect(CONTINUOUS_LIMIT_SECONDS).toBe(180);
    expect(() => validateDuration(180, "continuous")).not.toThrow();
    expect(() => validateDuration(181, "continuous")).toThrow();
  });
  it("uses eight-second PCM pieces", () => {
    expect(PIECE_SECONDS).toBe(8);
    const wav = encodeWav(new Float32Array(8 * PCM_SAMPLE_RATE));
    expect(readPcmWav(wav).durationSeconds).toBe(8);
    expect(() => validateDuration(8.1, "piece")).toThrow();
  });
  it("rejects a forged WAV length", () => {
    const wav = encodeWav(new Float32Array(160)); wav[40] = 0;
    expect(() => readPcmWav(wav)).toThrow();
  });
});

function rows(growth: number): PieceResult[] {
  return Array.from({ length: 23 }, (_, index) => ({ index, startSeconds: index * 8, durationSeconds: index === 22 ? 4 : 8, transcript: "Good morning", firstPartialMs: 400, finalTextMs: 8100, displayDelayMs: 8500 + index * growth, error: null, completed: true }));
}
describe("measured delay trend", () => {
  it("detects accumulating lag over three minutes", () => expect(delayTrend(rows(1000), 180).verdict).toBe("growing"));
  it("does not claim growing lag for a stable three-minute run", () => expect(delayTrend(rows(0), 180)).toEqual({ verdict: "stable", growthMs: 0 }));
  it("keeps shorter and failed runs inconclusive", () => {
    expect(delayTrend(rows(0), 60).verdict).toBe("incomplete");
    const failed = rows(0); const first = failed[0]; if (first) first.error = "failed";
    expect(delayTrend(failed, 180).verdict).toBe("incomplete");
  });
});

describe("server speech timing", () => {
  it("measures first PCM audio, not just the WAV header", async () => {
    const bytes = encodeWav(new Float32Array(160));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 44)); c.enqueue(bytes.subarray(44)); c.close(); } }), { status: 200 })));
    const result = await deepgramSpeak("Bonjour", "fr", "test-key");
    expect(result.voice).toBe("aura-2-agathe-fr");
    expect(atob(result.audioBase64).length).toBe(bytes.length);
    expect(result.firstAudioMs).toBeGreaterThanOrEqual(0);
  });
  it("retains real partial timing and combines final segments", async () => {
    class Socket extends EventTarget {
      readyState = 0;
      constructor(_url: string, _protocols: string[]) {
        super(); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
      }
      send(data: string | Uint8Array) {
        if (typeof data === "string") { this.readyState = 3; this.dispatchEvent(new Event("close")); return; }
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "Good" }] } }) }));
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "Good morning." }] } }) }));
      }
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("WebSocket", Socket);
    const result = await deepgramTranscribe(new Uint8Array(32), "test-key");
    expect(result.transcript).toBe("Good morning.");
    expect(result.firstPartialMs).not.toBeNull();
    expect(result.finalTextMs ?? -1).toBeGreaterThanOrEqual(result.firstPartialMs ?? 0);
  });
  it("splits longer translations without losing words and joins all PCM audio", () => {
    const text = "Bonjour mes frères et sœurs. ".repeat(100).trim();
    const parts = splitSpeechText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(parts.join(" ")).toBe(text);
    const wav = joinSpeechWav([encodeWav(new Float32Array(100)), encodeWav(new Float32Array(200))]);
    expect(readPcmWav(wav).pcm.length).toBe(600);
  });
});