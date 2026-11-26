import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readPcmWav, validateDuration } from "@/lib/deepgram";
import { translateText } from "@/lib/translate";
import { transcribeWithAssemblyAI } from "@/lib/assemblyai.server";
import { recordUsage } from "@/lib/usage.server";

/** Seconds of listener speech each visitor may send per UTC day. Separate from the public demo allowance. */
export const REPLY_LIMIT_SECONDS = 60;

/**
 * A listener answers the preacher in their own language. The reply is transcribed (AssemblyAI), translated to
 * English (DeepL) and saved for the operator. Public (no sign-in), limited per visitor per day, live sessions only.
 */
export const replyFromListener = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    code: z.string().regex(/^[a-z0-9]{6,20}$/),
    language: z.enum(["fr", "es"]),
    audioBase64: z.string().min(1).max(700_000),
  }).parse(input))
  .handler(async ({ data }) => {
    const assemblyKey = process.env["ASSEMBLYAI_API_KEY"];
    if (!assemblyKey) throw new Error("Replies are not configured yet");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, "interpret");

    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const { visitorKey } = await import("@/lib/visitor.server");
    const { data: session } = await db.from("sessions").select("id, status, church_id").eq("public_code", data.code).maybeSingle();
    if (!session) throw new Error("This service was not found");
    if (session.status !== "live") throw new Error("Replies are only open while the service is live");

    const { data: used, error } = await db.rpc("demo_take_seconds", {
      p_key: `reply:${await visitorKey()}`, p_seconds: Math.max(1, Math.ceil(durationSeconds)), p_limit: REPLY_LIMIT_SECONDS,
    });
    if (error) throw new Error("Replies are unavailable right now");
    if (used === null || used === undefined) throw new Error("You have used today's reply allowance. Please try again tomorrow.");

    const original = await transcribeWithAssemblyAI(bytes, data.language, assemblyKey);
    if (!original) throw new Error("No speech was recognised. Please speak closer to the microphone and try again.");
    const english = await translateText(original, data.language, "en");
    const { error: insertError } = await db.from("session_replies").insert({
      session_id: session.id, language: data.language, original, english,
    });
    if (insertError) throw new Error("Could not send your reply");
    await recordUsage(session.church_id, "stt_seconds", "assemblyai", durationSeconds, "reply");
    await recordUsage(session.church_id, "translation_chars", "deepl", original.length, "reply");
    return { original, english };
  });
