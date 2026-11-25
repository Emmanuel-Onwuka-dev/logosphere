import { TARGET_LANGUAGES } from "@/lib/languages";

const NAMES: Record<string, string> = {
  en: "English",
  ...Object.fromEntries(TARGET_LANGUAGES.map((l) => [l.code, l.name])),
};

export function languageName(code: string): string {
  return NAMES[code] ?? code;
}

/** DeepL target codes for the active languages. Portuguese uses Brazilian spelling. */
const DEEPL_TARGET: Record<string, string> = { fr: "FR", es: "ES", pt: "PT-BR", en: "EN-US" };
const DEEPL_SOURCE: Record<string, string> = { en: "EN", fr: "FR", es: "ES", pt: "PT" };

/** Free-plan keys end in ":fx" and must use the free host. */
export function deeplEndpoint(apiKey: string): string {
  return apiKey.trim().endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
}

/**
 * Translate spoken text between two languages with DeepL. Server-side only:
 * DEEPL_API_KEY is read from the environment at call time and never returned.
 */
export async function translateText(text: string, source: string, target: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  if (source === target) return clean;
  const apiKey = process.env["DEEPL_API_KEY"];
  if (!apiKey) throw new Error("DEEPL_API_KEY is not set");
  const sourceCode = DEEPL_SOURCE[source];
  const targetCode = DEEPL_TARGET[target];
  if (!sourceCode || !targetCode) throw new Error(`DeepL does not support ${languageName(source)} to ${languageName(target)}`);

  const res = await fetch(deeplEndpoint(apiKey), {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [clean], source_lang: sourceCode, target_lang: targetCode }),
  });
  if (!res.ok) {
    // Status and DeepL's message only; the key is never included.
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepL translation failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as { translations?: { text?: string }[] };
  const out = (body.translations ?? []).map((t) => t.text ?? "").join("").trim();
  if (!out) throw new Error("Translation came back empty");
  return out;
}
