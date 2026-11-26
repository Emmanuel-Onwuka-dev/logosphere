import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deepgramSpeak, deepgramTranscribe, runInterpretation } from "@/lib/deepgram.server";
import { readPcmWav, validateDuration } from "@/lib/deepgram";
import { translateText } from "@/lib/translate";
import { recordUsage } from "@/lib/usage.server";

const audioInput = z.object({ audioBase64: z.string().min(1).max(5_200_000), mode: z.enum(["clip", "piece"]) });
const textInput = z.object({ text: z.string().trim().min(1).max(12000), targetLanguage: z.enum(["fr", "es", "pt"]) });

export const transcribeDeepgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => audioInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!admin) throw new Error("Forbidden");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { pcm, durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, data.mode);
    const heard = await deepgramTranscribe(pcm, key);
    if (data.mode === "clip" && !heard.transcript) throw new Error("No English speech was recognised");
    return { ...heard, clipSeconds: durationSeconds };
  });

export const translateDeepgramText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => textInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!admin) throw new Error("Forbidden");
    const started = performance.now();
    const text = await translateText(data.text, "en", data.targetLanguage);
    return { text, durationMs: Math.round(performance.now() - started), model: "openai/gpt-6.1-terra" };
  });

export const speakDeepgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ text: z.string().trim().min(1).max(12000), targetLanguage: z.enum(["fr", "es"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!admin) throw new Error("Forbidden");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    return await deepgramSpeak(data.text, data.targetLanguage, key);
  });
/**
 * One numbered piece through hear → translate → speak. Failures come back as values (one retry on a dropped connection)
 * so the browser can play silence for that piece and move on without delaying the next ones.
 */
export const interpretPiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ audioBase64: z.string().min(1).max(700_000), targetLanguage: z.enum(["fr", "es"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!admin) throw new Error("Forbidden");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { pcm, durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, "interpret");
    return await runInterpretation(pcm, data.targetLanguage, key);
  });

/**
 * Live service: the preacher's device sends each microphone piece here; only church admins, media operators
 * or platform admins of a live session may call it. Status is written to channel_status for the session page.
 */
export const interpretLivePiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid(), audioBase64: z.string().min(1).max(700_000), targetLanguage: z.enum(["fr", "es"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: s } = await sb.from("sessions").select("id, church_id, status, target_languages").eq("id", data.sessionId).maybeSingle();
    if (!s) throw new Error("Session not found");
    const checks = await Promise.all([
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "church_admin" }),
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "media_operator" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
    ]);
    if (!checks.some((c: any) => c.data === true)) throw new Error("Forbidden");
    if (s.status !== "live" || !s.target_languages.includes(data.targetLanguage)) throw new Error("Channel is not live");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { pcm, durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, "interpret");
    const started = performance.now();
    let out;
    try {
      out = await runInterpretation(pcm, data.targetLanguage, key);
    } catch (e) {
      console.error("live piece failed:", e instanceof Error ? e.stack ?? e.message : e);
      throw e instanceof Error ? e : new Error("Live piece failed");
    }
    try {
      const { workerDb } = await import("@/lib/worker-db.server");
      await (workerDb() as any).from("channel_status").upsert({
        session_id: s.id, language: data.targetLanguage, status: out.error ? "error" : "running",
        last_error: out.error?.slice(0, 1000) ?? null, latency_ms: Math.round(performance.now() - started), worker_id: "preacher-device", engine_id: null,
      }, { onConflict: "session_id,language" });
    } catch (e) { console.warn("channel status not saved:", e instanceof Error ? e.message : e); }
    void recordUsage(s.church_id, "stt_seconds", "deepgram", durationSeconds, "live");
    void recordUsage(s.church_id, "translation_chars", "deepl", out.transcript.length, "live");
    void recordUsage(s.church_id, "tts_chars", "deepgram", out.translation.length, "live");
    return out;
  });

/**
 * Short-lived Deepgram token for the preacher's browser to stream audio straight to Deepgram.
 * The Deepgram key never reaches the browser, and the Worker does none of the audio work.
 */
export const getLiveSpeechToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: s } = await sb.from("sessions").select("id, church_id, status").eq("id", data.sessionId).maybeSingle();
    if (!s) throw new Error("Session not found");
    const checks = await Promise.all([
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "church_admin" }),
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "media_operator" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
    ]);
    if (!checks.some((c: any) => c.data === true)) throw new Error("Forbidden");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Could not start speech recognition (HTTP ${res.status}). Check the Deepgram key's permissions.`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error("Could not start speech recognition");
    return { token: body.access_token };
  });

/** One finished sentence from the preacher: translated, then voiced. Runs only while the session is live. */
export const speakTranslatedUtterance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    sessionId: z.string().uuid(),
    targetLanguage: z.enum(["fr", "es"]),
    text: z.string().trim().min(1).max(1000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: s } = await sb.from("sessions").select("id, church_id, status, target_languages").eq("id", data.sessionId).maybeSingle();
    if (!s) throw new Error("Session not found");
    const checks = await Promise.all([
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "church_admin" }),
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "media_operator" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
    ]);
    if (!checks.some((c: any) => c.data === true)) throw new Error("Forbidden");
    if (s.status !== "live" || !s.target_languages.includes(data.targetLanguage)) throw new Error("Channel is not live");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("Deepgram's server key has not been configured");
    const translation = await translateText(data.text, "en", data.targetLanguage);
    const spoken = await deepgramSpeak(translation, data.targetLanguage, key);
    void recordUsage(s.church_id, "translation_chars", "deepl", data.text.length, "live");
    void recordUsage(s.church_id, "tts_chars", "deepgram", translation.length, "live");
    return { translation, audioBase64: spoken.audioBase64 };
  });
