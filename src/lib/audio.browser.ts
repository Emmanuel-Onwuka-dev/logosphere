import { PCM_SAMPLE_RATE } from "@/lib/deepgram";

/** Decode WAV/MP3 or browser recordings locally; never contacts a speech provider. */
export async function decodeAudio(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * PCM_SAMPLE_RATE), PCM_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0).slice(), durationSeconds: rendered.length / PCM_SAMPLE_RATE };
  } finally { await context.close(); }
}