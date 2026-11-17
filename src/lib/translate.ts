import { TARGET_LANGUAGES } from "@/lib/languages";

const NAMES: Record<string, string> = {
  en: "English",
  ...Object.fromEntries(TARGET_LANGUAGES.map((l) => [l.code, l.name])),
};

export function languageName(code: string): string {
  return NAMES[code] ?? code;
}

/**
 * Translate spoken text between two languages using the project's built-in
 * model. The SDK reads its own server-side key, so nothing secret lives here.
 */
export async function translateText(text: string, source: string, target: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  if (source === target) return clean;
  const { generateResponse } = await import("@lovable.dev/ai-gateway");
  const res = await generateResponse({
    model: "openai/gpt-6.1-terra",
    instructions:
      `You translate a preacher's words from ${languageName(source)} into ${languageName(target)} ` +
      "for live interpretation in a church service. Keep the meaning, tone and pace of spoken speech. " +
      "Return only the translated words, with no notes, labels or quotation marks.",
    input: clean,
  });
  const parts: string[] = [];
  for (const item of res.output ?? []) {
    const content = (item as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const t = (block as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
  }
  const out = parts.join("").trim();
  if (!out) throw new Error("Translation came back empty");
  return out;
}
