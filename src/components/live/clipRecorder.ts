import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";

export type ClipRecorder = {
  /** Stops recording and returns the clip as base64 WAV at 16 kHz mono, plus its length in seconds. */
  stop: () => { audioBase64: string; seconds: number };
  /** Elapsed seconds so far. */
  elapsed: () => number;
  /** Releases the microphone without returning audio. */
  cancel: () => void;
};

/** Opens the microphone and records mono 16 kHz audio until stop() is called. Throws if access is denied. */
export async function openClipRecorder(): Promise<ClipRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain(); sink.gain.value = 0;
  const chunks: Float32Array[] = [];
  let samples = 0;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    samples += input.length;
  };
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  await ctx.resume().catch(() => {});

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    proc.onaudioprocess = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    stop: () => {
      const pcm = new Float32Array(samples);
      let offset = 0;
      for (const c of chunks) { pcm.set(c, offset); offset += c.length; }
      close();
      return { audioBase64: toBase64(encodeWav(pcm)), seconds: pcm.length / PCM_SAMPLE_RATE };
    },
    elapsed: () => samples / PCM_SAMPLE_RATE,
    cancel: close,
  };
}
