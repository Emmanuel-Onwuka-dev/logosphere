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

/** A translation service. Callers never name a vendor; the active one is chosen by TRANSLATION_PROVIDER. */
export type TranslationProvider = {
  name: string;
  translate: (text: string, sourceCode: string, targetCode: string) => Promise<string>;
};

const deepl: TranslationProvider = {
  name: "deepl",
  translate: async (text, sourceCode, targetCode) => {
    const apiKey = process.env["DEEPL_API_KEY"];
    if (!apiKey) throw new Error("DEEPL_API_KEY is not set");
    const request = () => fetch(deeplEndpoint(apiKey), {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: [text], source_lang: sourceCode, target_lang: targetCode }),
      signal: AbortSignal.timeout(15_000),
    });
    // One retry for temporary failures only: a network drop, rate limit (429) or server error (5xx).
    let res: Response;
    try {
      res = await request();
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 800)); res = await request(); }
    } catch {
      await new Promise((r) => setTimeout(r, 800));
      res = await request();
    }
    if (!res.ok) {
      // Status and DeepL's message only; the key is never included.
      const detail = await res.text().catch(() => "");
      throw new Error(`DeepL translation failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const body = (await res.json()) as { translations?: { text?: string }[] };
    return (body.translations ?? []).map((t) => t.text ?? "").join("").trim();
  },
};

/** Listed so the switch is explicit. Not connected yet; selecting it fails with a clear message. */
const googleCloud: TranslationProvider = {
  name: "google",
  translate: async () => {
    throw new Error("Google Cloud Translation is not connected yet. Set TRANSLATION_PROVIDER to deepl.");
  },
};

const PROVIDERS: Record<string, TranslationProvider> = { deepl, google: googleCloud };

/** The provider named by TRANSLATION_PROVIDER (default deepl). An unknown name is an error, never a silent fallback. */
export function activeTranslationProvider(): TranslationProvider {
  const name = (process.env["TRANSLATION_PROVIDER"] ?? "deepl").trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown translation provider "${name}". Use deepl or google.`);
  return provider;
}

/**
 * Translate spoken text between two languages. Server-side only; provider keys are read from the environment
 * at call time and never returned.
 */
export async function translateText(text: string, source: string, target: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  if (source === target) return clean;
  const sourceCode = DEEPL_SOURCE[source];
  const targetCode = DEEPL_TARGET[target];
  if (!sourceCode || !targetCode) throw new Error(`DeepL does not support ${languageName(source)} to ${languageName(target)}`);
  const provider = activeTranslationProvider();
  const out = await provider.translate(clean, sourceCode, targetCode);
  if (!out) throw new Error("Translation came back empty");
  return out;
}
