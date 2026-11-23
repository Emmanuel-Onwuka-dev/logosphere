import { fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ transcribe: vi.fn(), translate: vi.fn(), speak: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/deepgram.functions", () => ({ transcribeDeepgram: calls.transcribe, translateDeepgramText: calls.translate, speakDeepgram: calls.speak, interpretPiece: vi.fn() }));
vi.mock("@/lib/audio.browser", () => ({ decodeAudio: async () => ({ samples: new Float32Array(16000), durationSeconds: 1 }) }));
import { DeepgramLab } from "@/components/playground/DeepgramLab";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function prepare() {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} }));
  calls.transcribe.mockResolvedValue({ transcript: "Good morning.", firstPartialMs: 150, finalTextMs: 1100, durationMs: 1110, clipSeconds: 1 });
  calls.translate.mockResolvedValue({ text: "Bonjour.", durationMs: 800, model: "openai/gpt-6.1-terra" });
  calls.speak.mockResolvedValue({ audioBase64: "aGk=", mimeType: "audio/wav", voice: "aura-2-agathe-fr", firstAudioMs: 200, durationMs: 700 });
  const view = render(<DeepgramLab />);
  fireEvent.change(view.getByLabelText("Upload English WAV or MP3"), { target: { files: [new File(["audio"], "sermon.mp3", { type: "audio/mpeg" })] } });
  await waitFor(() => expect(view.getByRole("button", { name: "Run clip test" })).not.toBeDisabled());
  return view;
}

describe("Deepgram user workflow (mocked provider results)", () => {
  it("sends English audio for transcription then French text for speech", async () => {
    const view = await prepare();
    fireEvent.click(view.getByRole("button", { name: "Run clip test" }));
    await waitFor(() => expect(calls.speak).toHaveBeenCalledWith({ data: { text: "Bonjour.", targetLanguage: "fr" } }));
    expect(calls.transcribe).toHaveBeenCalledWith({ data: { audioBase64: expect.any(String), mode: "clip" } });
    expect(calls.translate).toHaveBeenCalledWith({ data: { text: "Good morning.", targetLanguage: "fr" } });
    expect(calls.transcribe.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(calls.translate.mock.invocationCallOrder[0] ?? 0);
  });
  it("translates Portuguese without requesting an unsupported voice", async () => {
    const view = await prepare();
    fireEvent.change(view.getByLabelText("To"), { target: { value: "pt" } });
    fireEvent.click(view.getByRole("button", { name: "Run clip test" }));
    await waitFor(() => expect(calls.translate).toHaveBeenCalledWith({ data: { text: "Good morning.", targetLanguage: "pt" } }));
    await waitFor(() => expect(view.getByRole("button", { name: "Run clip test" })).not.toBeDisabled());
    expect(calls.speak).not.toHaveBeenCalled();
  });
});