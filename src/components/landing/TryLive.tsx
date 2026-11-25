import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square } from "lucide-react";
import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";
import { DEMO_LIMIT_SECONDS, MAX_PIECE_SECONDS, nextLiveCut } from "@/lib/interpretation";
import { demoInterpretPiece } from "@/lib/demo.functions";
import { TESTED_LANGUAGE_CODES, TARGET_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

type Line = { index: number; english: string; translation: string };
const MAX_PENDING = 3;
const SILENCE_PEAK = 0.01;
const LANGS = TARGET_LANGUAGES.filter((l) => TESTED_LANGUAGE_CODES.includes(l.code));

/**
 * Public demo on the landing page: speak English, hear it in French or Spanish.
 * Audio is cut at pauses, translated piece by piece and played back in order. Nothing is stored.
 */
export function TryLive() {
  const demo = useServerFn(demoInterpretPiece);
  const [lang, setLang] = useState<string>(LANGS[0]?.code ?? "fr");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [remaining, setRemaining] = useState(DEMO_LIMIT_SECONDS);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setStatus(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch { setStatus("Microphone access is needed. Allow it in your browser and try again."); return; }

    const capture = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    const out = new AudioContext();
    const src = capture.createMediaStreamSource(stream);
    const proc = capture.createScriptProcessor(4096, 1, 1);
    const sink = capture.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(capture.destination);

    let stopped = false;
    let buffer = new Float32Array(0);
    let pieceIndex = 0;
    let pending = 0;
    let queue: Promise<void> = Promise.resolve();
    let playEnd = 0;
    let spent = 0;

    const play = (b64: string | null) => {
      if (!b64) return;
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      void out.decodeAudioData(bytes.buffer).then((buf) => {
        if (stopped) return;
        const when = Math.max(out.currentTime + 0.05, playEnd);
        const node = out.createBufferSource(); node.buffer = buf; node.connect(out.destination); node.start(when);
        playEnd = when + buf.duration;
      }).catch(() => {});
    };

    const stop = () => {
      if (stopped) return;
      stopped = true; runningRef.current = false;
      proc.onaudioprocess = null;
      stream.getTracks().forEach((t) => t.stop());
      void capture.close(); void out.close();
      setRunning(false);
    };
    stopRef.current = stop;
    runningRef.current = true;
    setRunning(true); setLines([]); setRemaining(DEMO_LIMIT_SECONDS);

    const send = (pcm: Float32Array) => {
      const index = pieceIndex++;
      let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
      // Silence and over-busy moments cost nothing: they are skipped, but the order is kept.
      if (peak < SILENCE_PEAK || pending >= MAX_PENDING) return;
      const seconds = pcm.length / PCM_SAMPLE_RATE;
      if (spent + seconds > DEMO_LIMIT_SECONDS) { setStatus(`You have used today's ${DEMO_LIMIT_SECONDS / 60}-minute demo. Create a free account to continue.`); stop(); return; }
      spent += seconds;
      const audioBase64 = toBase64(encodeWav(pcm));
      pending += 1;
      const request = demo({ data: { audioBase64, targetLanguage: lang as "fr" | "es" } })
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Request failed" } as const));
      queue = queue.then(() => request).then((r) => {
        pending -= 1;
        if (stopped) return;
        if ("error" in r && r.error) { setStatus(r.error); if (r.error.includes("today's")) stop(); return; }
        if (!("transcript" in r)) return;
        if (r.remainingSeconds !== undefined) setRemaining(r.remainingSeconds);
        if (r.transcript) setLines((all) => [...all, { index, english: r.transcript, translation: r.translation }]);
        play(r.audioBase64);
      });
    };

    proc.onaudioprocess = (e) => {
      if (stopped) return;
      const input = e.inputBuffer.getChannelData(0);
      const grown = new Float32Array(buffer.length + input.length); grown.set(buffer); grown.set(input, buffer.length); buffer = grown;
      if (buffer.length > (MAX_PIECE_SECONDS + 1) * PCM_SAMPLE_RATE) buffer = buffer.slice(buffer.length - (MAX_PIECE_SECONDS + 1) * PCM_SAMPLE_RATE);
      const cut = nextLiveCut(buffer);
      if (!cut) return;
      const end = Math.round(cut.endSeconds * PCM_SAMPLE_RATE);
      send(buffer.slice(0, end));
      buffer = buffer.slice(end);
    };
    await out.resume().catch(() => {});
  }

  const used = DEMO_LIMIT_SECONDS - remaining;
  const target = LANGS.find((l) => l.code === lang);

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Try it now</p>
          <p className="mt-1 font-display text-2xl">Speak English. Hear it in {target?.name}.</p>
        </div>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => { if (!running) setLang(l.code); }}
              disabled={running}
              className={cn("rounded-full border px-4 py-2 text-sm transition disabled:opacity-60",
                lang === l.code ? "border-foreground bg-foreground text-background" : "bg-background hover:border-foreground/40")}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {running ? (
          <button onClick={() => stopRef.current?.()} className="inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-2.5 text-sm font-medium">
            <Square className="size-4" /> Stop
          </button>
        ) : (
          <button onClick={start} disabled={remaining <= 0} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Mic className="size-4" /> {used > 0 ? "Start again" : "Start listening"}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {running ? "Listening…" : "Microphone on this device only"} · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} of today's demo left
        </span>
      </div>

      {status && (
        <p className="mt-4 text-sm text-destructive">
          {status}{" "}
          {status.includes("free account") && <Link to="/auth" search={{ mode: "up" }} className="underline">Create an account</Link>}
        </p>
      )}

      <div className="mt-6 min-h-24 space-y-3">
        {lines.length === 0 && <p className="text-sm text-muted-foreground">Your English and the {target?.name} translation will appear here as you speak.</p>}
        {lines.map((l) => (
          <div key={l.index} className="rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">{l.english}</p>
            <p className="mt-1 font-display text-lg">{l.translation}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Speech is sent to our speech and translation providers while you speak, and is not kept after it is translated.
        Each visitor gets {DEMO_LIMIT_SECONDS / 60} minutes a day.
      </p>
    </div>
  );
}
