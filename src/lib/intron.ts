/**
 * Intron speech services adapter.
 *
 * Intron gives us two of the three steps a Nigerian-language interpretation
 * needs: speech-to-text for the preacher's voice, and a text-to-speech voice
 * for Hausa / Yoruba / Igbo. The middle step (translation) is supplied by the
 * caller, so this module stays engine-agnostic.
 *
 * Contracts (docs.voice.intron.io):
 *   POST /file/v1/upload/sync  multipart: audio_file_name, audio_file_blob,
 *        use_language_asr_input  -> data.audio_transcript   (<= 120 s of audio)
 *   POST /tts/v1/generate      json: text, voice_language, voice_accent,
 *        voice_gender, output_audio_format -> data.audio_path (a wav URL)
 */

export const INTRON_BASE = "https://infer.voice.intron.io";
const STT_PATH = "/file/v1/upload/sync";
const STT_STATUS_PATH = "/file/v1/status/";
const TTS_PATH = "/tts/v1/generate";

type SttReply = { data?: { audio_transcript?: string; processing_status?: string; file_id?: string }; message?: string; status?: string };

/** Docs allow 4096 characters, but the API's own error message enforces 1200. */
export const TTS_TEXT_LIMIT = 1200;

/** Target language code -> the voice Intron expects for it. */
export const INTRON_VOICES: Record<string, { language: string; accent: string }> = {
  ha: { language: "ha", accent: "hausa" },
  yo: { language: "yo", accent: "yoruba" },
  ig: { language: "ig", accent: "igbo" },
};

/** Intron checks the file name: "audio/webm;codecs=opus" must become ".webm", not ".webmcodecsopus". */
export function intronExtension(mimeType: string): string {
  const sub = (mimeType.split(";")[0] ?? "").split("/")[1]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = { wav: "wav", "x-wav": "wav", wave: "wav", mpeg: "mp3", mp3: "mp3", ogg: "ogg", webm: "webm", mp4: "m4a", "x-m4a": "m4a", m4a: "m4a", aac: "aac", flac: "flac", aiff: "aiff", "x-aiff": "aiff" };
  return map[sub] ?? "wav";
}

export function isIntronEndpoint(url: string | null | undefined): boolean {
  return !!url && url.includes("intron.io");
}

export function intronVoiceFor(code: string): { language: string; accent: string } | null {
  return INTRON_VOICES[code] ?? null;
}

/** Split text so every piece fits Intron's per-request character limit. */
export function splitForTTS(text: string, limit = TTS_TEXT_LIMIT): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const pieces: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"), window.lastIndexOf(" "));
    const take = cut > 0 ? cut + 1 : limit;
    pieces.push(rest.slice(0, take).trim());
    rest = rest.slice(take).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function readU32(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24);
}

function writeU32(b: Uint8Array, i: number, v: number): void {
  b[i] = v & 255;
  b[i + 1] = (v >>> 8) & 255;
  b[i + 2] = (v >>> 16) & 255;
  b[i + 3] = (v >>> 24) & 255;
}

/** PCM payload + format chunk of a RIFF/WAVE file. */
function wavParts(b: Uint8Array): { fmt: Uint8Array; data: Uint8Array } | null {
  const tag = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length < 12 || tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE") return null;
  let fmt: Uint8Array | null = null;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const id = tag(i, 4);
    const size = readU32(b, i + 4);
    const start = i + 8;
    const end = Math.min(start + size, b.length);
    if (id === "fmt ") fmt = b.subarray(start, end);
    else if (id === "data") chunks.push(b.subarray(start, end));
    i = start + size + (size % 2);
  }
  if (!fmt || chunks.length === 0) return null;
  const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { data.set(c, off); off += c.length; }
  return { fmt, data };
}

/** Join several mono wav files into one, keeping the first file's format. */
export function joinWav(parts: Uint8Array[]): Uint8Array {
  const parsed = parts.map((p) => wavParts(p));
  if (parsed.some((p) => !p)) throw new Error("Intron returned audio we could not stitch together");
  const fmt = parsed[0]!.fmt;
  const data = new Uint8Array(parsed.reduce((n, p) => n + p!.data.length, 0));
  let off = 0;
  for (const p of parsed) { data.set(p!.data, off); off += p!.data.length; }
  const pad = data.length % 2;
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + data.length + pad);
  const put = (i: number, s: string) => { for (let k = 0; k < s.length; k++) out[i + k] = s.charCodeAt(k); };
  put(0, "RIFF"); writeU32(out, 4, out.length - 8); put(8, "WAVE");
  put(12, "fmt "); writeU32(out, 16, fmt.length); out.set(fmt, 20);
  const di = 20 + fmt.length + 8;
  put(di - 8, "data"); writeU32(out, di - 4, data.length); out.set(data, di);
  return out;
}

type FetchOpts = { timeoutMs: number };

async function fetchWithTimeout(url: string, init: RequestInit, { timeoutMs }: FetchOpts): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw e instanceof Error && e.name === "AbortError" ? new Error("Intron timed out") : new Error("Could not reach Intron");
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: turn the preacher's audio into written text. */
export async function intronTranscribe(input: {
  base: string; key: string; audio: Uint8Array; mimeType: string; language: string; timeoutMs: number;
}): Promise<string> {
  const fd = new FormData();
  const name = `clip.${intronExtension(input.mimeType)}`;
  fd.append("audio_file_name", name);
  // Intron judges the type by the attached file name, so pass it explicitly (some servers drop a File's own name).
  const cleanType = (input.mimeType || "audio/wav").split(";")[0]!.trim();
  fd.append("audio_file_blob", new Blob([input.audio.slice()], { type: cleanType }), name);
  fd.append("use_language_asr_input", input.language);
  const res = await fetchWithTimeout(`${input.base}${STT_PATH}`, {
    method: "POST", headers: { Authorization: `Bearer ${input.key}` }, body: fd,
  }, { timeoutMs: input.timeoutMs });
  const json = await res.json().catch(() => ({})) as SttReply;
  const text = json.data?.audio_transcript?.trim();
  if (text) return text;
  // Intron sometimes answers with "file queued for processing" instead of the words.
  // The file id then has to be polled until the transcript is ready.
  const fileId = json.data?.file_id;
  if (fileId) return pollFileStatus(input.base, input.key, fileId, input.timeoutMs);
  if (!res.ok) throw new Error(json.message || `Intron speech-to-text failed (HTTP ${res.status})`);
  throw new Error("Intron heard no words in that audio");
}

/** Wait for a queued transcription to finish. */
async function pollFileStatus(base: string, key: string, fileId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetchWithTimeout(`${base}${STT_STATUS_PATH}${fileId}`, {
      headers: { Authorization: `Bearer ${key}` },
    }, { timeoutMs: Math.min(15000, Math.max(1000, deadline - Date.now())) });
    const json = await res.json().catch(() => ({})) as SttReply;
    const status = json.data?.processing_status ?? "";
    const text = json.data?.audio_transcript?.trim();
    if (status === "FILE_TRANSCRIBED" && text) return text;
    if (/FAIL/i.test(status)) throw new Error("Intron could not transcribe that audio");
    if (!res.ok) throw new Error(`Intron file status check failed (HTTP ${res.status})`);
  }
  throw new Error("Intron took too long to transcribe that audio — try a shorter clip");
}

/** Step 3: turn text into spoken audio in the target language. */
export async function intronSynthesize(input: {
  base: string; key: string; text: string; voice: { language: string; accent: string }; gender: "male" | "female"; timeoutMs: number;
}): Promise<Uint8Array> {
  const res = await fetchWithTimeout(`${input.base}${TTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${input.key}` },
    body: JSON.stringify({
      text: input.text,
      voice_language: input.voice.language,
      voice_accent: input.voice.accent,
      voice_gender: input.gender,
      output_audio_format: "wav",
    }),
  }, { timeoutMs: input.timeoutMs });
  const json = await res.json().catch(() => ({})) as { data?: { audio_path?: string; processing_status?: string }; message?: string; status?: string };
  if (!res.ok) throw new Error(json.message || `Intron speech generation failed (HTTP ${res.status})`);
  const path = json.data?.audio_path;
  if (!path) throw new Error("Intron did not return any audio");
  // The audio comes back as a plain download link — sending the key here makes the storage reject it.
  const audio = await fetchWithTimeout(path, {}, { timeoutMs: input.timeoutMs });
  if (!audio.ok) throw new Error(`Could not download the generated audio (HTTP ${audio.status})`);
  return new Uint8Array(await audio.arrayBuffer());
}

/**
 * Cheap real check: ask Intron to speak one word in the engine's language.
 * Proves the address, the key and the voice all work.
 */
export async function intronHealthCheck(input: {
  base: string; key: string; language: string; timeoutMs: number;
}): Promise<{ ok: boolean; status_code: number | null; error: string | null }> {
  const voice = intronVoiceFor(input.language) ?? { language: "en", accent: "hausa" };
  try {
    const res = await fetchWithTimeout(`${input.base}${TTS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${input.key}` },
      body: JSON.stringify({
        text: "ok", voice_language: voice.language, voice_accent: voice.accent,
        voice_gender: "female", output_audio_format: "wav",
      }),
    }, { timeoutMs: input.timeoutMs });
    const json = await res.json().catch(() => ({})) as { data?: { audio_path?: string }; message?: string };
    const ok = res.ok && !!json.data?.audio_path;
    return { ok, status_code: res.status, error: ok ? null : json.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status_code: null, error: e instanceof Error ? e.message : "Could not reach Intron" };
  }
}

/**
 * Full English recording -> target-language speech.
 * `translate` is injected so this module never depends on which model translates.
 */
export async function runIntronPipeline(input: {
  audioBase64: string; mimeType: string; sourceLanguage: string; targetLanguage: string;
  secret: string; timeoutMs: number; gender?: "male" | "female";
  translate: (text: string, source: string, target: string) => Promise<string>;
}): Promise<{ transcript: string; translated: string; audioBase64: string; audioMime: string }> {
  const voice = intronVoiceFor(input.targetLanguage);
  if (!voice) throw new Error(`Intron has no spoken voice for "${input.targetLanguage}" yet — try Hausa, Yoruba or Igbo`);
  const transcript = await intronTranscribe({
    base: INTRON_BASE, key: input.secret, audio: base64ToBytes(input.audioBase64),
    mimeType: input.mimeType, language: input.sourceLanguage, timeoutMs: input.timeoutMs,
  });
  const translated = await input.translate(transcript, input.sourceLanguage, input.targetLanguage);
  const pieces = splitForTTS(translated);
  if (!pieces.length) throw new Error("Translation came back empty");
  const wavs: Uint8Array[] = [];
  for (const piece of pieces) {
    wavs.push(await intronSynthesize({
      base: INTRON_BASE, key: input.secret, text: piece, voice,
      gender: input.gender ?? "female", timeoutMs: input.timeoutMs,
    }));
  }
  const audio = wavs.length === 1 ? wavs[0]! : joinWav(wavs);
  return { transcript, translated, audioBase64: bytesToBase64(audio), audioMime: "audio/wav" };
}
