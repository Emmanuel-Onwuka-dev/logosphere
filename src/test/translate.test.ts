import { describe, expect, it, vi, afterEach } from "vitest";
import { deeplEndpoint, translateText } from "@/lib/translate";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("deeplEndpoint", () => {
  it("uses the free host for keys ending in :fx", () => {
    expect(deeplEndpoint("abc:fx")).toBe("https://api-free.deepl.com/v2/translate");
  });
  it("uses the pro host otherwise", () => {
    expect(deeplEndpoint("abc")).toBe("https://api.deepl.com/v2/translate");
  });
});

describe("translateText", () => {
  it("sends DeepL codes, maps pt to PT-BR, and returns the text", async () => {
    vi.stubEnv("DEEPL_API_KEY", "key:fx");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: [{ text: "Que a paz esteja com vocês." }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await translateText("Peace be with you.", "en", "pt");
    expect(out).toBe("Que a paz esteja com vocês.");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect(JSON.parse(String(init.body))).toEqual({ text: ["Peace be with you."], source_lang: "EN", target_lang: "PT-BR" });
  });

  it("refuses paused languages instead of calling DeepL", async () => {
    vi.stubEnv("DEEPL_API_KEY", "key:fx");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(translateText("Peace", "en", "ha")).rejects.toThrow(/does not support/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly when the key is missing", async () => {
    vi.stubEnv("DEEPL_API_KEY", "");
    await expect(translateText("Peace", "en", "fr")).rejects.toThrow("DEEPL_API_KEY is not set");
  });
  it("translates a listener reply from French into English (EN-US target)", async () => {
    vi.stubEnv("DEEPL_API_KEY", "key:fx");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: [{ text: "Peace be with you." }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await translateText("Que la paix soit avec vous.", "fr", "en")).toBe("Peace be with you.");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: ["Que la paix soit avec vous."], source_lang: "FR", target_lang: "EN-US" });
  });
});

describe("translation provider switch", () => {
  it("rejects an unknown provider instead of falling back", async () => {
    vi.stubEnv("TRANSLATION_PROVIDER", "nonsense");
    vi.stubEnv("DEEPL_API_KEY", "key:fx");
    await expect(translateText("Peace", "en", "fr")).rejects.toThrow(/Unknown translation provider/);
    vi.unstubAllEnvs();
  });
  it("says clearly that Google is not connected yet", async () => {
    vi.stubEnv("TRANSLATION_PROVIDER", "google");
    await expect(translateText("Peace", "en", "fr")).rejects.toThrow(/not connected yet/);
    vi.unstubAllEnvs();
  });
});
