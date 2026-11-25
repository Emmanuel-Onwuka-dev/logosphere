import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runInterpretation } from "@/lib/deepgram.server";
import { readPcmWav, validateDuration, LONG_TEST_LIMIT_SECONDS } from "@/lib/deepgram";
import { TESTED_LANGUAGE_CODES } from "@/lib/languages";

const BUCKET = "sermon-audio";
const SIGNED_URL_SECONDS = 60 * 60;
const targetsSchema = z.array(z.enum(["fr", "es"])).min(1).max(2);

export async function assertChurchOperator(context: { supabase: any; userId: string }, churchId: string) {
  const sb = context.supabase;
  const checks = await Promise.all([
    sb.rpc("has_church_role", { _user_id: context.userId, _church_id: churchId, _role: "church_admin" }),
    sb.rpc("has_church_role", { _user_id: context.userId, _church_id: churchId, _role: "media_operator" }),
    sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
  ]);
  if (!checks.some((c: any) => c.data === true)) throw new Error("Forbidden");
}

export async function recordingFor(id: string) {
  const { workerDb } = await import("@/lib/worker-db.server");
  const { data, error } = await (workerDb() as any).from("recordings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the recording");
  if (!data) throw new Error("Recording not found");
  return data as { id: string; church_id: string; target_languages: string[]; status: string; duration_seconds: number; public_code: string; title: string };
}

/** Creates a recording the browser will fill piece by piece. */
export const createRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    churchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    targets: targetsSchema,
    durationSeconds: z.number().positive().max(LONG_TEST_LIMIT_SECONDS),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertChurchOperator(context, data.churchId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const targets = [...new Set(data.targets)].filter((t) => TESTED_LANGUAGE_CODES.includes(t));
    const { data: row, error } = await (workerDb() as any).from("recordings").insert({
      church_id: data.churchId, title: data.title, target_languages: targets, duration_seconds: data.durationSeconds,
      status: "processing", created_by: context.userId,
    }).select("id, public_code").single();
    if (error || !row) throw new Error("Could not create the recording");
    return { id: row.id as string, publicCode: row.public_code as string };
  });

/**
 * Translates one pause-aware piece of a recording: hear → translate → speak, stores the audio and the text.
 * The browser calls this once per piece, so no single request runs for the length of the sermon.
 */
export const processRecordingPiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    recordingId: z.string().uuid(),
    language: z.enum(["fr", "es"]),
    index: z.number().int().min(0),
    startSeconds: z.number().min(0),
    endSeconds: z.number().positive(),
    audioBase64: z.string().min(1).max(700_000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const recording = await recordingFor(data.recordingId);
    await assertChurchOperator(context, recording.church_id);
    if (recording.status !== "processing") throw new Error("This recording is no longer processing");
    if (!recording.target_languages.includes(data.language)) throw new Error("This language was not chosen for the recording");
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("The speech service is not configured");

    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { pcm, durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, "interpret");

    const out = await runInterpretation(pcm, data.language, key);
    const base = {
      recording_id: data.recordingId, language: data.language, piece_index: data.index,
      start_seconds: data.startSeconds, end_seconds: data.endSeconds,
      english: out.transcript, translation: out.translation, error: out.error,
    };
    let storagePath: string | null = null;
    if (out.audioBase64) {
      storagePath = `${data.recordingId}/${data.language}/${String(data.index).padStart(5, "0")}.wav`;
      const audio = Uint8Array.from(atob(out.audioBase64), (c) => c.charCodeAt(0));
      const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, audio, { contentType: "audio/wav", upsert: true });
      if (uploadError) throw new Error("Could not store the translated audio");
    }
    const { error } = await db.from("recording_pieces").upsert({ ...base, storage_path: storagePath }, { onConflict: "recording_id,language,piece_index" });
    if (error) throw new Error("Could not save the piece");
    return { ok: !out.error, error: out.error, english: out.transcript, translation: out.translation };
  });

/** Marks a recording ready once the browser has processed every piece. */
export const finishRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const recording = await recordingFor(data.recordingId);
    await assertChurchOperator(context, recording.church_id);
    const { count } = await db.from("recording_pieces").select("*", { count: "exact", head: true }).eq("recording_id", data.recordingId);
    const status = count && count > 0 ? "ready" : "failed";
    await db.from("recordings").update({ status }).eq("id", data.recordingId);
    return { status, pieces: count ?? 0 };
  });

/** Public listener view: the recording's languages, and short-lived links to its translated pieces. */
export const getPublicRecording = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ code: z.string().regex(/^[a-z0-9]{6,20}$/) }).parse(input))
  .handler(async ({ data }) => {
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const { data: rec } = await db.from("recordings").select("id, title, status, target_languages, duration_seconds").eq("public_code", data.code).maybeSingle();
    if (!rec || rec.status !== "ready") return null;
    const { data: pieces } = await db.from("recording_pieces")
      .select("language, piece_index, start_seconds, end_seconds, english, translation, storage_path")
      .eq("recording_id", rec.id).order("language").order("piece_index");
    const paths = (pieces ?? []).map((p: any) => p.storage_path).filter(Boolean) as string[];
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data: signed, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (error) throw new Error("Could not prepare the audio");
      for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
    }
    return {
      title: rec.title as string,
      durationSeconds: Number(rec.duration_seconds),
      languages: rec.target_languages as string[],
      pieces: (pieces ?? []).map((p: any) => ({
        language: p.language as string, index: p.piece_index as number,
        startSeconds: Number(p.start_seconds), endSeconds: Number(p.end_seconds),
        english: p.english as string, translation: p.translation as string,
        url: p.storage_path ? urls.get(p.storage_path) ?? null : null,
      })),
    };
  });

/** Lists the recordings for a church, for the operator page. */
export const listRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ churchId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertChurchOperator(context, data.churchId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const { data: rows } = await (workerDb() as any).from("recordings")
      .select("id, title, status, target_languages, duration_seconds, public_code, created_at")
      .eq("church_id", data.churchId).order("created_at", { ascending: false }).limit(50);
    return rows ?? [];
  });
