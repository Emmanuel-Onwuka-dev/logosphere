import { useEffect, useRef, useState } from "react";
import { Track, LocalAudioTrack, type Room } from "livekit-client";
import { useServerFn } from "@tanstack/react-start";
import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";
import { DEFAULT_SPEED, MAX_PIECE_SECONDS, nextLiveCut } from "@/lib/interpretation";
import { timeStretch } from "@/lib/timestretch";
import { interpretLivePiece } from "@/lib/deepgram.functions";

export type LiveLang = "fr" | "es";
export const LIVE_LANGS: LiveLang[] = ["fr", "es"];
export type ChannelInfo = { pieces: number; failed: number; delayS: number | null; lastError: string | null };
const MAX_PENDING = 4;

/**
 * Interprets the preacher's microphone on this device: cuts it into pause-aware pieces, sends each piece to the
 * server for hear → translate → speak, and publishes the results in number order as track "interp-<lang>".
 */
export function useLiveInterpreter(opts: { room: Room | null; mic: MediaStreamTrack | null; sessionId: string; languages: LiveLang[]; live: boolean }) {
  const { room, mic, sessionId, live } = opts;
  const langKey = opts.languages.join(",");
  const interpret = useServerFn(interpretLivePiece);
  const [info, setInfo] = useState<Partial<Record<LiveLang, ChannelInfo>>>({});
  const liveRef = useRef(live); liveRef.current = live;

  useEffect(() => {
    if (!room || !mic || !langKey) return;
    const langs = langKey.split(",") as LiveLang[];
    let stopped = false;
    const capture = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    const out = new AudioContext();
    const src = capture.createMediaStreamSource(new MediaStream([mic]));
    const proc = capture.createScriptProcessor(4096, 1, 1);
    const sink = capture.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(capture.destination);

    let buffer = new Float32Array(0);
    let bufferStartMs = performance.now(); // wall time of the buffer's first sample
    let pieceIndex = 0;

    type Chan = { dest: MediaStreamAudioDestinationNode; track: LocalAudioTrack; ready: Map<number, { buf: AudioBuffer; speechStartMs: number }>; next: number; playEnd: number; pending: number };
    const chans = new Map<LiveLang, Chan>();
    const patch = (l: LiveLang, f: (c: ChannelInfo) => ChannelInfo) => setInfo((all) => ({ ...all, [l]: f(all[l] ?? { pieces: 0, failed: 0, delayS: null, lastError: null }) }));

    void (async () => {
      for (const l of langs) {
        const dest = out.createMediaStreamDestination();
        const track = new LocalAudioTrack(dest.stream.getAudioTracks()[0]!, undefined, false);
        try { await room.localParticipant.publishTrack(track as any, { name: `interp-${l}`, source: Track.Source.Unknown }); }
        catch (e) { patch(l, (c) => ({ ...c, lastError: e instanceof Error ? e.message : "Could not publish" })); continue; }
        if (stopped) { await room.localParticipant.unpublishTrack(track as any); return; }
        chans.set(l, { dest, track, ready: new Map(), next: 0, playEnd: 0, pending: 0 });
      }
      await out.resume().catch(() => {});
    })();

    const drain = (l: LiveLang, c: Chan) => {
      while (!stopped && c.ready.has(c.next)) {
        const { buf, speechStartMs } = c.ready.get(c.next)!; c.ready.delete(c.next);
        const when = Math.max(out.currentTime + 0.05, c.playEnd);
        const node = out.createBufferSource(); node.buffer = buf; node.connect(c.dest); node.start(when);
        c.playEnd = when + buf.duration; c.next += 1;
        const delayS = Math.round((performance.now() + (when - out.currentTime) * 1000 - speechStartMs) / 100) / 10;
        if (buf.duration > 0.05) patch(l, (i) => ({ ...i, delayS }));
      }
    };

    const send = (pcm: Float32Array, speechStartMs: number) => {
      const index = pieceIndex++;
      const length = pcm.length / PCM_SAMPLE_RATE;
      let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
      const silence = () => out.createBuffer(1, Math.max(1, Math.round(length * out.sampleRate)), out.sampleRate);
      const b64 = toBase64(encodeWav(pcm));
      for (const l of langs) {
        const c = chans.get(l); if (!c) continue;
        // Too quiet to contain speech, or too far behind: keep order with silence instead of calling the server.
        if (peak < 0.01 || c.pending >= MAX_PENDING) { c.ready.set(index, { buf: silence(), speechStartMs }); drain(l, c); continue; }
        c.pending += 1;
        void interpret({ data: { sessionId, audioBase64: b64, targetLanguage: l } })
          .then(async (r) => {
            if (r.error || !r.audioBase64) {
              if (r.error) patch(l, (i) => ({ ...i, failed: i.failed + 1, lastError: r.error }));
              return silence();
            }
            const bytes = Uint8Array.from(atob(r.audioBase64), (ch) => ch.charCodeAt(0));
            const decoded = await out.decodeAudioData(bytes.buffer);
            const speed = DEFAULT_SPEED[l];
            patch(l, (i) => ({ ...i, pieces: i.pieces + 1, lastError: null }));
            if (speed === 1) return decoded;
            const data = timeStretch(decoded.getChannelData(0), decoded.sampleRate, speed);
            const b = out.createBuffer(1, data.length, decoded.sampleRate); b.copyToChannel(data, 0); return b;
          })
          .catch((e: unknown) => { patch(l, (i) => ({ ...i, failed: i.failed + 1, lastError: e instanceof Error ? e.message : "Request failed" })); return silence(); })
          .then((buf) => { c.pending -= 1; if (stopped) return; c.ready.set(index, { buf, speechStartMs }); drain(l, c); });
      }
    };

    proc.onaudioprocess = (e) => {
      if (stopped) return;
      if (!liveRef.current) { buffer = new Float32Array(0); bufferStartMs = performance.now(); return; }
      const input = e.inputBuffer.getChannelData(0);
      if (!buffer.length) bufferStartMs = performance.now() - (input.length / PCM_SAMPLE_RATE) * 1000;
      const grown = new Float32Array(buffer.length + input.length); grown.set(buffer); grown.set(input, buffer.length); buffer = grown;
      if (buffer.length > (MAX_PIECE_SECONDS + 1) * PCM_SAMPLE_RATE) buffer = buffer.slice(buffer.length - (MAX_PIECE_SECONDS + 1) * PCM_SAMPLE_RATE);
      const cut = nextLiveCut(buffer);
      if (!cut) return;
      const end = Math.round(cut.endSeconds * PCM_SAMPLE_RATE);
      send(buffer.slice(0, end), bufferStartMs);
      buffer = buffer.slice(end); bufferStartMs += cut.endSeconds * 1000;
    };

    return () => {
      stopped = true; proc.onaudioprocess = null;
      for (const c of chans.values()) { void room.localParticipant.unpublishTrack(c.track as any).catch(() => {}); c.track.stop(); }
      void capture.close(); void out.close(); setInfo({});
    };
  }, [room, mic, sessionId, langKey, interpret]);

  return info;
}
