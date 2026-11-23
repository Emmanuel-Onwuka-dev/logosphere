import { PIECE_TIMEOUT_MS } from "@/lib/interpretation";
import { translateText } from "@/lib/translate";
import { DEEPGRAM_VOICES, PCM_SAMPLE_RATE, toBase64, splitSpeechText, joinSpeechWav } from "@/lib/deepgram";

export async function deepgramTranscribe(pcm: Uint8Array, key: string) {
  const start = performance.now();
  const url = "wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=true&smart_format=true";
  // Both Node's standards WebSocket and the published Worker support this documented auth protocol.
  // The socket is created only here on the server; neither URL nor credential is returned.
  const socket = new WebSocket(url, ["token", key]);
  return await new Promise<{ transcript: string; firstPartialMs: number | null; finalTextMs: number | null; durationMs: number }>((resolve, reject) => {
    let firstPartialMs: number | null = null;
    let finalTextMs: number | null = null;
    let settled = false;
    const finalParts: string[] = [];
    let latestPartial = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); clearTimeout(sendTimer); if (socket.readyState < 2) socket.close(); };
    const fail = (message: string) => { if (settled) return; settled = true; cleanup(); reject(new Error(message)); };
    const finish = () => {
      if (settled) return;
      const transcript = finalParts.join(" ").trim();
      if (!transcript && latestPartial) { fail("Deepgram closed before finalising the transcript"); return; }
      settled = true; cleanup();
      resolve({ transcript, firstPartialMs, finalTextMs, durationMs: Math.round(performance.now() - start) });
    };
    timer = setTimeout(() => fail("Deepgram transcription timed out"), pcm.length / (PCM_SAMPLE_RATE * 2) * 1000 + 30000);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
      try { message = JSON.parse(event.data); } catch { fail("Deepgram returned an unreadable transcription response"); return; }
      if (message.type === "Error") { fail("Deepgram rejected transcription; check the key, model access and account balance"); return; }
      if (message.type !== "Results") return;
      const text = message.channel?.alternatives?.[0]?.transcript?.trim();
      if (!text) return;
      if (message.is_final) { finalParts.push(text); finalTextMs = Math.round(performance.now() - start); latestPartial = ""; }
      else { latestPartial = text; firstPartialMs ??= Math.round(performance.now() - start); }
    });
    socket.addEventListener("error", () => fail("Deepgram streaming connection failed; check the key and Nova-3 access"));
    socket.addEventListener("close", finish);
    socket.addEventListener("open", () => {
      const opened = performance.now();
      const frameBytes = PCM_SAMPLE_RATE * 2 / 10; // 100 ms of real-time PCM.
      let offset = 0;
      const send = () => {
        if (settled || socket.readyState !== 1) return;
        if (offset >= pcm.length) { socket.send(JSON.stringify({ type: "CloseStream" })); return; }
        socket.send(pcm.slice(offset, offset + frameBytes));
        offset += frameBytes;
        const nextAt = opened + Math.min(offset, pcm.length) / (PCM_SAMPLE_RATE * 2) * 1000;
        sendTimer = setTimeout(send, Math.max(0, nextAt - performance.now()));
      };
      send();
    });
  });
}

async function speakPiece(text: string, language: string, key: string) {
  const voice = DEEPGRAM_VOICES[language];
  if (!voice) throw new Error("Deepgram Aura-2 has no Portuguese voice in this test");
  if (!text.trim() || text.length > 2000) throw new Error("Speech text must contain 1–2,000 characters");
  const started = performance.now();
  const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&container=wav&sample_rate=24000`, {
    method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(60000), redirect: "manual",
  });
  if (!response.ok) throw new Error(`Deepgram ${voice} speech failed (HTTP ${response.status}); check voice access and account balance`);
  if (!response.body) throw new Error("Deepgram returned no audio");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let firstAudioMs: number | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length; chunks.push(value);
      // Do not call a WAV header alone 'first audio'.
      if (length > 44) firstAudioMs ??= Math.round(performance.now() - started);
      if (length > 20_000_000) { await reader.cancel(); throw new Error("Speech output is too large"); }
    }
  } finally { reader.releaseLock(); }
  if (firstAudioMs === null) throw new Error("Deepgram returned an empty speech recording");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { audioBase64: toBase64(bytes), mimeType: "audio/wav", voice, firstAudioMs, durationMs: Math.round(performance.now() - started) };
}

export async function deepgramSpeak(text: string, language: string, key: string) {
  if (!DEEPGRAM_VOICES[language]) throw new Error("Deepgram Aura-2 has no Portuguese voice in this test");
  if (!text.trim() || text.length > 12000) throw new Error("Speech text must contain 1–12,000 characters");
  const started = performance.now();
  const pieces: Uint8Array[] = [];
  let firstAudioMs: number | null = null;
  let voice = "";
  for (const piece of splitSpeechText(text)) {
    const requestOffsetMs = performance.now() - started;
    const out = await speakPiece(piece, language, key);
    firstAudioMs ??= Math.round(requestOffsetMs + out.firstAudioMs); voice = out.voice;
    pieces.push(Uint8Array.from(atob(out.audioBase64), (c) => c.charCodeAt(0)));
  }
  return { audioBase64: toBase64(joinSpeechWav(pieces)), mimeType: "audio/wav", voice, firstAudioMs, durationMs: Math.round(performance.now() - started) };
}

export async function deepgramHealth(key: string) {
  const response = await fetch("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(10000), redirect: "manual" });
  return { ok: response.ok, status_code: response.status, error: response.ok ? null : `Deepgram account check failed (HTTP ${response.status})` };
}
export type InterpretResult = {
  transcript: string; translation: string; audioBase64: string | null;
  hearMs: number | null; translateMs: number | null; speakMs: number | null; error: string | null;
};

/** Shared by the Playground server function and offline measurements; times out instead of retrying. */
export async function runInterpretation(pcm: Uint8Array, target: "fr" | "es", key: string): Promise<InterpretResult> {
  const out: InterpretResult = { transcript: "", translation: "", audioBase64: null, hearMs: null, translateMs: null, speakMs: null, error: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    let t = performance.now();
    const heard = await deepgramTranscribe(pcm, key);
    out.hearMs = Math.round(performance.now() - t); out.transcript = heard.transcript;
    if (!heard.transcript) return; // Silence in, silence out — not a failure.
    t = performance.now();
    try { out.translation = await translateText(heard.transcript, "en", target); }
    catch (e) { throw new Error(`Translation error: ${e instanceof Error ? e.message : "failed"}`); }
    out.translateMs = Math.round(performance.now() - t);
    t = performance.now();
    const spoken = await deepgramSpeak(out.translation, target, key);
    out.speakMs = Math.round(performance.now() - t); out.audioBase64 = spoken.audioBase64;
  })();
  try {
    await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${PIECE_TIMEOUT_MS / 1000} s`)), PIECE_TIMEOUT_MS); })]);
  } catch (e) {
    out.error = e instanceof Error ? e.message : "Interpretation failed"; out.audioBase64 = null;
    console.error("interpret piece failed:", out.error);
  } finally { clearTimeout(timer); }
  return out;
}
