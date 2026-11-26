const API = "https://api.assemblyai.com/v2";
/** Polls are spaced out: the Workers Free plan allows a limited number of subrequests per request. */
const POLL_MS = 8_000;
const MAX_WAIT_MS = 270_000;

export type AssemblyTimedSegment = {
  start: number;
  end: number;
  text: string;
  /** Translations for this utterance, keyed by target code. Missing languages are filled by the fallback. */
  translations: Record<string, string>;
};

/**
 * Prerecorded transcription with AssemblyAI Speech Understanding translation, in one transcript job.
 * Uses only POST /v2/transcript (translation inside the request). The LLM Gateway endpoint is never called.
 * Returns timed utterances, each with its translations when AssemblyAI produced them.
 */
export async function assemblyaiTranscribeAndTranslate(url: string, key: string, targets: string[]) {
  const submit = await fetch(`${API}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: url,
      language_code: "en",
      speaker_labels: true,
      speech_understanding: {
        request: { translation: { target_languages: targets, match_original_utterance: true, formal: true } },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`AssemblyAI could not start the transcript (HTTP ${submit.status}); check the key and balance`);
  const { id } = (await submit.json()) as { id: string };

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const poll = await fetch(`${API}/transcript/${id}`, { headers: { authorization: key }, signal: AbortSignal.timeout(15_000) });
    if (!poll.ok) throw new Error(`AssemblyAI status check failed (HTTP ${poll.status})`);
    const body = (await poll.json()) as {
      status: string;
      error?: string | null;
      audio_duration?: number | null;
      speech_understanding?: { response?: { translation?: { status?: string } } };
      utterances?: { start: number; end: number; text: string; translated_texts?: Record<string, string> }[] | null;
    };
    if (body.status === "error") throw new Error(`AssemblyAI could not transcribe: ${body.error ?? "unknown error"}`);
    if (body.status !== "completed") continue;

    const translationStatus = body.speech_understanding?.response?.translation?.status ?? "none";
    const segments: AssemblyTimedSegment[] = (body.utterances ?? [])
      .map((u) => ({
        start: Number(u.start) / 1000,
        end: Number(u.end) / 1000,
        text: (u.text ?? "").trim(),
        translations: Object.fromEntries(
          Object.entries(u.translated_texts ?? {}).map(([code, text]) => [code, (text ?? "").trim()]).filter(([, text]) => text),
        ),
      }))
      .filter((s) => s.text.length > 0 && s.end > s.start);
    return { durationSeconds: Number(body.audio_duration ?? 0), translationStatus, segments };
  }
  throw new Error("AssemblyAI is still processing this recording. Try Start transcription again in a few minutes.");
}
