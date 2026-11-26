import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertChurchOperator, recordingFor } from "@/lib/recordings.functions";
import { deepgramSpeak } from "@/lib/deepgram.server";
import { deepgramTranscribeUrl } from "@/lib/deepgram.prerecorded.server";
import { assemblyaiTranscribeAndTranslate } from "@/lib/assemblyai.prerecorded.server";
import { translateText } from "@/lib/translate";
import { TESTED_LANGUAGE_CODES } from "@/lib/languages";
import { recordUsage } from "@/lib/usage.server";

const BUCKET = "sermon-audio";
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const LINK_SECONDS = 60 * 60;
const langs = z.enum(["fr", "es"]);
const SAFE_EXT = /\.(mp3|wav|m4a|ogg|flac|webm)$/i;

async function workspaceRecording(context: { supabase: any; userId: string }, recordingId: string) {
  const recording = await recordingFor(recordingId);
  await assertChurchOperator(context, recording.church_id);
  return recording as typeof recording & { source_path: string | null; transcript_status: string; archived_at: string | null; preacher: string | null; sermon_date: string | null; duration_seconds: number };
}

/** Creates a sermon record and a one-time upload link for its audio file. The browser uploads the file directly. */
export const createSermon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    churchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    preacher: z.string().trim().max(120).optional(),
    sermonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    targets: z.array(langs).min(1).max(2),
    fileName: z.string().min(1).max(200).regex(SAFE_EXT, "Upload an audio file (MP3, WAV, M4A, OGG, FLAC or WebM)"),
    sizeBytes: z.number().int().positive().max(MAX_SOURCE_BYTES, "Audio files can be up to 50 MB"),
    mimeType: z.string().regex(/^audio\//),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertChurchOperator(context, data.churchId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const id = crypto.randomUUID();
    const ext = data.fileName.match(SAFE_EXT)![0].toLowerCase();
    const path = `sources/${id}/original${ext}`;
    const targets = [...new Set(data.targets)].filter((t) => TESTED_LANGUAGE_CODES.includes(t));
    const { error } = await db.from("recordings").insert({
      id, church_id: data.churchId, title: data.title, preacher: data.preacher || null, sermon_date: data.sermonDate || null,
      target_languages: targets, duration_seconds: 0, status: "processing", transcript_status: "none",
      source_path: path, source_mime: data.mimeType, created_by: context.userId,
    });
    if (error) throw new Error("Could not create the sermon");
    const { data: upload, error: uploadError } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (uploadError || !upload) throw new Error("Could not prepare the upload");
    return { id, path, token: upload.token as string };
  });

/**
 * The prerecorded speech provider, chosen by RECORDING_STT_PROVIDER (default deepgram).
 * AssemblyAI also returns translations in the same job; segments without one are translated by DeepL later.
 */
export function recordingSttProvider(): "deepgram" | "assemblyai" {
  const name = (process.env["RECORDING_STT_PROVIDER"] ?? "deepgram").trim().toLowerCase();
  if (name === "deepgram" || name === "assemblyai") return name;
  throw new Error(`Unknown recording provider "${name}". Use deepgram or assemblyai.`);
}

/** Transcribes the uploaded file and stores the timed segments (with AssemblyAI translations when that provider is active). */
export const startTranscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    if (!recording.source_path) throw new Error("This sermon has no audio file");
    const provider = recordingSttProvider();
    const key = provider === "assemblyai" ? process.env["ASSEMBLYAI_API_KEY"] : process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("The speech service is not configured");
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    await db.from("recordings").update({ transcript_status: "transcribing", transcript_error: null }).eq("id", recording.id);
    try {
      const { data: link, error: linkError } = await db.storage.from(BUCKET).createSignedUrl(recording.source_path, LINK_SECONDS);
      if (linkError || !link?.signedUrl) throw new Error("Could not read the uploaded file");
      const wanted = ((recording.target_languages as string[]) ?? []).filter((l) => TESTED_LANGUAGE_CODES.includes(l as any));
      const result = provider === "assemblyai"
        ? await assemblyaiTranscribeAndTranslate(link.signedUrl, key, wanted.length ? wanted : [...TESTED_LANGUAGE_CODES])
        : await deepgramTranscribeUrl(link.signedUrl, key).then((r) => ({
            ...r,
            translationStatus: "none",
            segments: r.segments.map((s) => ({ ...s, translations: {} as Record<string, string> })),
          }));
      if (result.segments.length === 0) throw new Error("No speech was recognised in this recording");
      await db.from("recording_segments").delete().eq("recording_id", recording.id);
      const { error } = await db.from("recording_segments").insert(result.segments.map((s, idx) => {
        const hasTranslations = Object.keys(s.translations).length > 0;
        return {
          recording_id: recording.id, idx, start_seconds: s.start, end_seconds: s.end, original_text: s.text,
          translations: s.translations, translation_provider: hasTranslations ? "assemblyai" : null,
        };
      }));
      if (error) throw new Error("Could not save the transcript");
      await db.from("recordings").update({ transcript_status: "ready", duration_seconds: result.durationSeconds }).eq("id", recording.id);
      await recordUsage(recording.church_id, "stt_seconds", provider, result.durationSeconds, "recording");
      if (provider === "assemblyai") {
        for (const lang of wanted.length ? wanted : [...TESTED_LANGUAGE_CODES]) {
          const chars = result.segments.reduce((n, s) => n + (s.translations[lang]?.length ?? 0), 0);
          if (chars > 0) await recordUsage(recording.church_id, "translation_chars", "assemblyai", chars, "recording");
        }
      }
      return { segments: result.segments.length, durationSeconds: result.durationSeconds, translationStatus: result.translationStatus };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transcription failed";
      await db.from("recordings").update({ transcript_status: "failed", transcript_error: message.slice(0, 500) }).eq("id", recording.id);
      throw new Error(message);
    }
  });

/** Saves the operator's corrections to transcript segments. Only the edited text changes; original text is kept. */
export const saveTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    recordingId: z.string().uuid(),
    edits: z.array(z.object({ idx: z.number().int().min(0), text: z.string().max(2000) })).max(2000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    for (const e of data.edits) {
      const { error } = await db.from("recording_segments").update({ edited_text: e.text.trim() }).eq("recording_id", recording.id).eq("idx", e.idx);
      if (error) throw new Error("Could not save the transcript");
    }
    return { saved: data.edits.length };
  });

/** Sets which languages this sermon is translated into. */
export const setSermonTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid(), targets: z.array(langs).min(1).max(2) }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    await (workerDb() as any).from("recordings").update({ target_languages: [...new Set(data.targets)] }).eq("id", recording.id);
    return { targets: data.targets };
  });

/** Translates one transcript segment and voices it. Stored as a timed piece for the listener and download. */
export const translateSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid(), language: langs, idx: z.number().int().min(0) }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const { data: seg, error: segError } = await db.from("recording_segments").select("*").eq("recording_id", recording.id).eq("idx", data.idx).maybeSingle();
    if (segError || !seg) throw new Error("Segment not found");
    const text = (seg.edited_text ?? seg.original_text ?? "").trim();
    let translation = "";
    let translatedBy: "assemblyai" | "deepl" = "deepl";
    let storagePath: string | null = null;
    if (text) {
      const key = process.env["DEEPGRAM_API_KEY"];
      if (!key) throw new Error("The speech service is not configured");
      // Use the translation made during transcription, unless the operator has edited this segment since.
      const kept = seg.edited_text == null ? (seg.translations as Record<string, string> | null)?.[data.language] : undefined;
      if (typeof kept === "string" && kept.trim()) {
        translation = kept.trim();
        translatedBy = "assemblyai";
      } else {
        translation = await translateText(text, "en", data.language);
      }
      const spoken = await deepgramSpeak(translation, data.language, key);
      storagePath = `${recording.id}/${data.language}/${String(data.idx).padStart(5, "0")}.wav`;
      const bytes = Uint8Array.from(atob(spoken.audioBase64), (c) => c.charCodeAt(0));
      const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType: "audio/wav", upsert: true });
      if (uploadError) throw new Error("Could not store the translated audio");
    }
    const { error } = await db.from("recording_pieces").upsert({
      recording_id: recording.id, language: data.language, piece_index: data.idx,
      start_seconds: Number(seg.start_seconds), end_seconds: Number(seg.end_seconds),
      english: text, translation, storage_path: storagePath, error: null,
    }, { onConflict: "recording_id,language,piece_index" });
    if (error) throw new Error("Could not save the translated segment");
    if (recording.status === "processing") await db.from("recordings").update({ status: "ready" }).eq("id", recording.id);
    if (text) {
      if (translatedBy === "deepl") await recordUsage(recording.church_id, "translation_chars", "deepl", text.length, "recording");
      await recordUsage(recording.church_id, "tts_chars", "deepgram", translation.length, "recording");
    }
    return { translation, hasAudio: !!storagePath };
  });

/** Everything the detail page needs: metadata, transcript, translated pieces and short-lived audio links. */
export const getSermon = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const [segments, pieces] = await Promise.all([
      db.from("recording_segments").select("idx, start_seconds, end_seconds, original_text, edited_text").eq("recording_id", recording.id).order("idx"),
      db.from("recording_pieces").select("language, piece_index, start_seconds, end_seconds, english, translation, storage_path").eq("recording_id", recording.id).order("language").order("piece_index"),
    ]);
    const paths = [recording.source_path, ...((pieces.data ?? []) as any[]).map((p) => p.storage_path)].filter(Boolean) as string[];
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, LINK_SECONDS);
      for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
    }
    return {
      recording: {
        id: recording.id, title: recording.title, preacher: recording.preacher, sermonDate: recording.sermon_date,
        durationSeconds: Number(recording.duration_seconds), status: recording.status, transcriptStatus: recording.transcript_status,
        transcriptError: (recording as any).transcript_error ?? null, targets: recording.target_languages, publicCode: recording.public_code,
        archived: !!recording.archived_at, sourceUrl: recording.source_path ? urls.get(recording.source_path) ?? null : null,
      },
      segments: ((segments.data ?? []) as any[]).map((s) => ({ idx: s.idx as number, start: Number(s.start_seconds), end: Number(s.end_seconds), original: s.original_text as string, edited: s.edited_text as string | null })),
      pieces: ((pieces.data ?? []) as any[]).map((p) => ({
        language: p.language as string, index: p.piece_index as number, start: Number(p.start_seconds), end: Number(p.end_seconds),
        english: p.english as string, translation: p.translation as string, url: p.storage_path ? urls.get(p.storage_path) ?? null : null,
      })),
    };
  });

/** Archive or restore a sermon. Archived sermons stay in the library but are hidden from the default list. */
export const setArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid(), archived: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    await (workerDb() as any).from("recordings").update({ archived_at: data.archived ? new Date().toISOString() : null }).eq("id", recording.id);
    return { archived: data.archived };
  });

/** Permanently deletes a sermon, its audio files and its transcript. The browser asks for confirmation first. */
export const deleteSermon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const recording = await workspaceRecording(context, data.recordingId);
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const { data: pieces } = await db.from("recording_pieces").select("storage_path").eq("recording_id", recording.id);
    const paths = [recording.source_path, ...((pieces ?? []) as any[]).map((p) => p.storage_path)].filter(Boolean) as string[];
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
    const { error } = await db.from("recordings").delete().eq("id", recording.id);
    if (error) throw new Error("Could not delete the sermon");
    return { deleted: true };
  });
