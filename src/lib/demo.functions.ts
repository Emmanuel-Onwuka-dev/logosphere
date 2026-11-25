import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runInterpretation } from "@/lib/deepgram.server";
import { readPcmWav, validateDuration } from "@/lib/deepgram";
import { DEMO_LIMIT_SECONDS } from "@/lib/interpretation";

const demoInput = z.object({
  audioBase64: z.string().min(1).max(700_000),
  targetLanguage: z.enum(["fr", "es"]),
});

/**
 * Public, rate-limited demo: one streaming piece of English speech in, translated text and speech out.
 * No sign-in. Each visitor gets DEMO_LIMIT_SECONDS of audio per UTC day, reserved before any paid call.
 */
export const demoInterpretPiece = createServerFn({ method: "POST" })
  .inputValidator((input) => demoInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env["DEEPGRAM_API_KEY"];
    if (!key) throw new Error("The demo is not configured yet");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Invalid audio encoding"); }
    const { pcm, durationSeconds } = readPcmWav(bytes);
    validateDuration(durationSeconds, "interpret");

    const { workerDb } = await import("@/lib/worker-db.server");
    const seconds = Math.max(1, Math.ceil(durationSeconds));
    const { data: used, error } = await (workerDb() as any).rpc("demo_take_seconds", {
      p_key: await (await import("@/lib/visitor.server")).visitorKey(), p_seconds: seconds, p_limit: DEMO_LIMIT_SECONDS,
    });
    if (error) throw new Error("The demo is unavailable right now");
    if (used === null || used === undefined) {
      throw new Error(`You have used today's ${DEMO_LIMIT_SECONDS / 60}-minute demo. Create a free account to continue.`);
    }

    const out = await runInterpretation(pcm, data.targetLanguage, key);
    return { ...out, remainingSeconds: Math.max(0, DEMO_LIMIT_SECONDS - Number(used)) };
  });
