import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { isActiveListener, sessionSeconds, fmtDuration } from "@/lib/sessions";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { intronExtension, isIntronEndpoint, intronVoiceFor, splitForTTS, joinWav, runIntronPipeline, TTS_TEXT_LIMIT } from "@/lib/intron.server";

describe("listener counting", () => {
  it("counts a listener seen 1 minute ago", () => {
    expect(isActiveListener({ left_at: null, last_seen_at: new Date(Date.now() - 30_000).toISOString() })).toBe(true);
  });
  it("drops a listener not seen for 3 minutes", () => {
    expect(isActiveListener({ left_at: null, last_seen_at: new Date(Date.now() - 90_000).toISOString() })).toBe(false);
  });
  it("drops a listener who left", () => {
    expect(isActiveListener({ left_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })).toBe(false);
  });
});

describe("session duration", () => {
  it("is 0 before start", () => expect(sessionSeconds({ started_at: null, ended_at: null, status: "draft" })).toBe(0));
  it("measures start to end", () =>
    expect(sessionSeconds({ started_at: "2026-01-01T10:00:00Z", ended_at: "2026-01-01T11:30:00Z", status: "ended" })).toBe(5400));
  it("formats 1h 30m", () => expect(fmtDuration(5400)).toBe("1h 30m"));
});

describe("language readiness", () => {
  it("offers exactly fr, es, pt, ig, yo, ha", () =>
    expect(TARGET_LANGUAGES.map((l) => l.code)).toEqual(["fr", "es", "pt", "ig", "yo", "ha"]));
  it("marks no language available while no engine is verified", () =>
    expect(TARGET_LANGUAGES.some((l) => l.status === "available" || l.status === "ready")).toBe(false));
  it("routes Nigerian languages through the cascaded pipeline", () =>
    expect(TARGET_LANGUAGES.filter((l) => l.region === "Nigerian").every((l) => l.pipeline === "cascaded")).toBe(true));
});

/** Minimal RIFF/WAVE writer so the tests do not need a real recording. */
function wav(pcm: number[]): Uint8Array {
  const fmt = new Uint8Array(16);
  const data = new Uint8Array(pcm);
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + data.length);
  const put = (i: number, s: string) => { for (let k = 0; k < s.length; k++) out[i + k] = s.charCodeAt(k); };
  const u32 = (i: number, v: number) => { out[i] = v & 255; out[i + 1] = (v >>> 8) & 255; out[i + 2] = (v >>> 16) & 255; out[i + 3] = (v >>> 24) & 255; };
  put(0, "RIFF"); u32(4, out.length - 8); put(8, "WAVE");
  put(12, "fmt "); u32(16, fmt.length); out.set(fmt, 20);
  put(36, "data"); u32(40, data.length); out.set(data, 44);
  return out;
}
function pcmOf(b: Uint8Array): number[] {
  const tag = (i: number) => String.fromCharCode(...b.subarray(i, i + 4));
  let i = 12;
  while (i + 8 <= b.length) {
    const size = (b[i + 4] ?? 0) | ((b[i + 5] ?? 0) << 8) | ((b[i + 6] ?? 0) << 16) | ((b[i + 7] ?? 0) << 24);
    if (tag(i) === "data") return [...b.subarray(i + 8, i + 8 + size)];
    i = i + 8 + size + (size % 2);
  }
  return [];
}

describe("Intron adapter", () => {
  it("names browser recordings with an extension Intron accepts", () => {
    expect(intronExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(intronExtension("audio/mp4")).toBe("m4a");
    expect(intronExtension("audio/mpeg")).toBe("mp3");
    expect(intronExtension("audio/ogg; codecs=opus")).toBe("ogg");
  });
  it("recognises Intron endpoints by address", () => {
    expect(isIntronEndpoint("https://infer.voice.intron.io/file/v1/upload/sync")).toBe(true);
    expect(isIntronEndpoint("https://example.com/speech")).toBe(false);
    expect(isIntronEndpoint(null)).toBe(false);
  });
  it("maps Hausa, Yoruba and Igbo to Intron voices, and has none for French", () => {
    expect(intronVoiceFor("ha")).toEqual({ language: "ha", accent: "hausa" });
    expect(intronVoiceFor("yo")).toEqual({ language: "yo", accent: "yoruba" });
    expect(intronVoiceFor("ig")).toEqual({ language: "ig", accent: "igbo" });
    expect(intronVoiceFor("fr")).toBeNull();
  });
  it("keeps every generated piece inside the 1200 character limit", () => {
    const sentence = "The Lord is my shepherd, I shall not want. ".repeat(60); // ~2520 chars
    const pieces = splitForTTS(sentence, TTS_TEXT_LIMIT);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= TTS_TEXT_LIMIT)).toBe(true);
    expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(sentence.trim().replace(/\s+/g, " "));
  });
  it("stitches generated clips back into one wav, in order", () => {
    const joined = joinWav([wav([1, 2, 3]), wav([4, 5])]);
    expect(String.fromCharCode(...joined.subarray(0, 4))).toBe("RIFF");
    expect(pcmOf(joined)).toEqual([1, 2, 3, 4, 5]);
    expect(() => joinWav([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])])).toThrow();
  });
  it("refuses a target language Intron cannot speak, before calling anything", async () => {
    await expect(runIntronPipeline({
      audioBase64: "aGk=", mimeType: "audio/wav", sourceLanguage: "en", targetLanguage: "fr",
      secret: "x", timeoutMs: 1000, translate: async () => { throw new Error("should not be reached"); },
    })).rejects.toThrow(/no spoken voice/);
  });
});
