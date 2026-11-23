import { describe, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ transcribe: vi.fn(), speak: vi.fn(), translate: vi.fn() }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/deepgram.server", () => ({ deepgramTranscribe: providers.transcribe, deepgramSpeak: providers.speak }));
vi.mock("@/lib/translate", () => ({ translateText: providers.translate }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: unknown) => fn };
  return chain;
} }));
import { transcribeDeepgram, translateDeepgramText, speakDeepgram } from "@/lib/deepgram.functions";

// The test double exposes handlers only; the production middleware verifies signed-in identities.
type Handler = (input: { data: unknown; context: { userId: string; supabase: { rpc: ReturnType<typeof vi.fn> } } }) => Promise<unknown>;
describe("Deepgram platform-admin boundary", () => {
  for (const [name, fn, data] of [
    ["transcription", transcribeDeepgram, { audioBase64: "aGk=", mode: "clip" }],
    ["translation", translateDeepgramText, { text: "Good morning", targetLanguage: "fr" }],
    ["speech", speakDeepgram, { text: "Bonjour", targetLanguage: "fr" }],
  ] as const) {
    it(`refuses ${name} before any provider call for a non-admin`, async () => {
      const rpc = vi.fn().mockResolvedValue({ data: false });
      await expect((fn as unknown as Handler)({ data, context: { userId: "test-user", supabase: { rpc } } })).rejects.toThrow("Forbidden");
      expect(rpc).toHaveBeenCalledWith("has_role", { _user_id: "test-user", _role: "platform_admin" });
      expect(providers.transcribe).not.toHaveBeenCalled();
      expect(providers.translate).not.toHaveBeenCalled();
      expect(providers.speak).not.toHaveBeenCalled();
    });
  }
});