import { useEffect, useRef, useState } from "react";
import { Track, LocalAudioTrack, type Room } from "livekit-client";
import { useServerFn } from "@tanstack/react-start";
import { PCM_SAMPLE_RATE } from "@/lib/deepgram";
import { DEFAULT_SPEED } from "@/lib/interpretation";
import { timeStretch } from "@/lib/timestretch";
import { getLiveSpeechToken, speakTranslatedUtterance } from "@/lib/deepgram.functions";

export type LiveLang = "fr" | "es";
export const LIVE_LANGS: LiveLang[] = ["fr", "es"];
export type ChannelInfo = { pieces: number; failed: number; delayS: number | null; lastError: string | null };

const MAX_PENDING = 4;
const DEEPGRAM_STREAM = "wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&endpointing=300";
const RECONNECT_MS = [1000, 2000, 5000, 10000];

type Ready = { buf: AudioBuffer | null; speechStartMs: number };
type Chan = { dest: MediaStreamAudioDestinationNode; track: LocalAudioTrack; ready: Map<number, Ready>; next: number; playEnd: number; pending: number };

/**
 * Interprets the preacher's microphone on this device.
 * The browser streams audio straight to Deepgram (with a 60-second token from the server), so the server never
 * handles the raw audio. Each finished sentence goes to the server for translation and speech, and the results are
 * published in order as track "interp-<lang>".
 */
export function useLiveInterpreter(opts: { room: Room | null; mic: MediaStreamTrack | null; sessionId: string; languages: LiveLang[]; live: boolean }) {
  const { room, mic, sessionId, live } = opts;
  const langKey = opts.languages.join(",");
  const getToken = useServerFn(getLiveSpeechToken);
  const speak = useServerFn(speakTranslatedUtterance);
  const [info, setInfo] = useState<Partial<Record<LiveLang, ChannelInfo>>>({});
  const liveRef = useRef(live); liveRef.current = live;

  useEffect(() => {
    if (!room || !mic || !langKey) return;
    const langs = langKey.split(",") as LiveLang[];
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnects = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const capture = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    const out = new AudioContext();
    const src = capture.createMediaStreamSource(new MediaStream([mic]));
    const proc = capture.createScriptProcessor(4096, 1, 1);
    const sink = capture.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(capture.destination);

    const chans = new Map<LiveLang, Chan>();
    const patch = (l: LiveLang, f: (c: ChannelInfo) => ChannelInfo) => setInfo((all) => ({ ...all, [l]: f(all[l] ?? { pieces: 0, failed: 0, delayS: null, lastError: null }) }));
    const patchAll = (message: string | null) => { for (const l of langs) patch(l, (c) => ({ ...c, lastError: message })); };

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

    /** Plays results strictly in sentence order. A null buffer is a skipped or failed sentence: it keeps the order. */
    const drain = (l: LiveLang, c: Chan) => {
      while (!stopped && c.ready.has(c.next)) {
        const { buf, speechStartMs } = c.ready.get(c.next)!; c.ready.delete(c.next);
        c.next += 1;
        if (!buf) continue;
        const when = Math.max(out.currentTime + 0.05, c.playEnd);
        const node = out.createBufferSource(); node.buffer = buf; node.connect(c.dest); node.start(when);
        c.playEnd = when + buf.duration;
        const delayS = Math.round((performance.now() + (when - out.currentTime) * 1000 - speechStartMs) / 100) / 10;
        patch(l, (i) => ({ ...i, delayS }));
      }
    };

    let sentence = 0;
    /** A finished sentence from Deepgram: translated and voiced for each language, in order. */
    const speakSentence = (text: string) => {
      const index = sentence++;
      const endedAt = performance.now();
      for (const l of langs) {
        const c = chans.get(l); if (!c) continue;
        if (c.pending >= MAX_PENDING) { c.ready.set(index, { buf: null, speechStartMs: endedAt }); drain(l, c); continue; }
        c.pending += 1;
        void speak({ data: { sessionId, targetLanguage: l, text } })
          .then(async (r) => {
            const bytes = Uint8Array.from(atob(r.audioBase64), (ch) => ch.charCodeAt(0));
            const decoded = await out.decodeAudioData(bytes.buffer);
            patch(l, (i) => ({ ...i, pieces: i.pieces + 1, lastError: null }));
            const speed = DEFAULT_SPEED[l];
            if (speed === 1) return decoded;
            const data = timeStretch(decoded.getChannelData(0), decoded.sampleRate, speed);
            const b = out.createBuffer(1, data.length, decoded.sampleRate); b.copyToChannel(data, 0); return b;
          })
          .catch((e: unknown) => { patch(l, (i) => ({ ...i, failed: i.failed + 1, lastError: e instanceof Error ? e.message : "Request failed" })); return null; })
          .then((buf) => { c.pending -= 1; if (stopped) return; c.ready.set(index, { buf, speechStartMs: endedAt }); drain(l, c); });
      }
    };

    let finals: string[] = [];
    const onDeepgram = (raw: string) => {
      let msg: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === "Error") { patchAll("Speech recognition reported an error"); return; }
      if (msg.type !== "Results") return;
      const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (msg.is_final && text) finals.push(text);
      // Only complete sentences are translated: Deepgram marks them with speech_final.
      if (msg.speech_final && finals.length) {
        const sentenceText = finals.join(" ").trim();
        finals = [];
        if (sentenceText) speakSentence(sentenceText);
      }
    };

    const connect = async () => {
      if (stopped) return;
      try {
        const { token } = await getToken({ data: { sessionId } });
        if (stopped) return;
        const ws = new WebSocket(DEEPGRAM_STREAM, ["bearer", token]);
        socket = ws;
        ws.onopen = () => { reconnects = 0; patchAll(null); };
        ws.onmessage = (e) => { if (typeof e.data === "string") onDeepgram(e.data); };
        ws.onclose = () => {
          if (stopped) return;
          const wait = RECONNECT_MS[Math.min(reconnects, RECONNECT_MS.length - 1)]!;
          reconnects += 1;
          patchAll("Speech connection lost. Reconnecting…");
          retryTimer = setTimeout(connect, wait);
        };
        ws.onerror = () => { /* onclose follows and handles the retry */ };
      } catch (e) {
        if (stopped) return;
        patchAll(e instanceof Error ? e.message : "Could not start speech recognition");
        const wait = RECONNECT_MS[Math.min(reconnects, RECONNECT_MS.length - 1)]!;
        reconnects += 1;
        retryTimer = setTimeout(connect, wait);
      }
    };
    void connect();

    // Sends 16 kHz audio in 256 ms frames. While the session is paused, silence is sent so the connection stays open.
    proc.onaudioprocess = (e) => {
      if (stopped) return;
      const input = e.inputBuffer.getChannelData(0);
      const ws = socket;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const pcm = new Int16Array(input.length);
      if (liveRef.current) {
        for (let i = 0; i < input.length; i++) { const s = Math.max(-1, Math.min(1, input[i] ?? 0)); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      }
      ws.send(pcm.buffer);
    };

    return () => {
      stopped = true; proc.onaudioprocess = null;
      if (retryTimer) clearTimeout(retryTimer);
      try { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" })); } catch { /* closing anyway */ }
      socket?.close();
      for (const c of chans.values()) { void room.localParticipant.unpublishTrack(c.track as any).catch(() => {}); c.track.stop(); }
      void capture.close(); void out.close(); setInfo({});
    };
  }, [room, mic, sessionId, langKey, getToken, speak]);

  return info;
}
