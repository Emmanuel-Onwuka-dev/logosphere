import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { translateText } from "@/lib/translate";
import { recordUsage } from "@/lib/usage.server";

/** Written replies each visitor may send per UTC day. Separate from the public demo allowance. */
export const REPLY_LIMIT_MESSAGES = 30;
export const REPLY_MAX_CHARACTERS = 300;

/**
 * A listener writes a short message to the preacher in their own language, like a comment in a live chat.
 * The message is translated to English (DeepL) and saved for the operator as text. Public (no sign-in),
 * limited per visitor per day, live sessions only.
 */
export const replyFromListener = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    code: z.string().regex(/^[a-z0-9]{6,20}$/),
    language: z.enum(["fr", "es"]),
    text: z.string().trim().min(1).max(REPLY_MAX_CHARACTERS),
  }).parse(input))
  .handler(async ({ data }) => {
    const { workerDb } = await import("@/lib/worker-db.server");
    const db = workerDb() as any;
    const { visitorKey } = await import("@/lib/visitor.server");
    const { data: session } = await db.from("sessions").select("id, status, church_id").eq("public_code", data.code).maybeSingle();
    if (!session) throw new Error("This service was not found");
    if (session.status !== "live") throw new Error("Replies are only open while the service is live");

    const { data: used, error } = await db.rpc("demo_take_seconds", {
      p_key: `reply:${await visitorKey()}`, p_seconds: 1, p_limit: REPLY_LIMIT_MESSAGES,
    });
    if (error) throw new Error("Replies are unavailable right now");
    if (used === null || used === undefined) throw new Error("You have sent today's messages. Please try again tomorrow.");

    const english = await translateText(data.text, data.language, "en");
    const { error: insertError } = await db.from("session_replies").insert({
      session_id: session.id, language: data.language, original: data.text, english,
    });
    if (insertError) throw new Error("Could not send your message");
    void recordUsage(session.church_id, "translation_chars", "deepl", data.text.length, "reply");
    return { original: data.text, english };
  });
