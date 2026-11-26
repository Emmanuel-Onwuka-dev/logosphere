import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Headphones, Play, Square, Zap } from "lucide-react";
import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";
import { DEMO_LIMIT_SECONDS, MAX_PIECE_SECONDS, nextLiveCut } from "@/lib/interpretation";
import { demoInterpretPiece } from "@/lib/demo.functions";
import { TESTED_LANGUAGE_CODES, TARGET_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

type Line = { index: number; english: string; translation: string };
const MAX_PENDING = 3;
const SILENCE_PEAK = 0.01;
const METER_BARS = 24;
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
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0));
  const stopRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);
  const linesCount = useRef(0);

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
    // Read-only meter: shows what the microphone is picking up. It does not affect the audio sent for translation.
    const analyser = capture.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const meter = setInterval(() => {
      analyser.getByteFrequencyData(bins);
      const per = Math.floor(bins.length / METER_BARS);
      setLevels(Array.from({ length: METER_BARS }, (_, b) => {
        let sum = 0; for (let i = b * per; i < (b + 1) * per; i++) sum += bins[i] ?? 0;
        return Math.min(1, sum / per / 180);
      }));
    }, 80);

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
      clearInterval(meter); setLevels(Array(METER_BARS).fill(0));
      proc.onaudioprocess = null;
      stream.getTracks().forEach((t) => t.stop());
      void capture.close(); void out.close();
      setRunning(false);
    };
    stopRef.current = stop;
    runningRef.current = true;
    setRunning(true); setLines([]); setRemaining(DEMO_LIMIT_SECONDS); linesCount.current = 0;

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
        if (r.transcript) { linesCount.current += 1; setStatus(null); setLines((all) => [...all, { index, english: r.transcript, translation: r.translation }]); }
        else if (linesCount.current === 0) setStatus("No English speech was picked up in the last few seconds. Speak closer to the microphone.");
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

  const target = LANGS.find((l) => l.code === lang);
  const minutes = DEMO_LIMIT_SECONDS / 60;
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const hearing = running && levels.some((v) => v > 0.25);

  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-[28px] border bg-card shadow-card">
      {/* Window chrome */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex gap-2" aria-hidden>
          <span className="size-3 rounded-full bg-muted-foreground/25" />
          <span className="size-3 rounded-full bg-muted-foreground/25" />
          <span className="size-3 rounded-full bg-muted-foreground/25" />
        </div>
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          <span className={cn("size-2 rounded-full", running ? "bg-emerald-500" : "bg-emerald-500/60")} /> Live demo
        </p>
      </div>

      <div className="p-6">
        {/* Mode toggle: Face-to-face is not built yet, so it is shown disabled. */}
        <div className="flex rounded-full border bg-secondary/40 p-1" role="group" aria-label="Demo mode">
          <span className="flex-1 rounded-full bg-foreground px-4 py-3 text-center text-sm font-medium text-background">Translate for me</span>
          <span className="flex flex-1 items-center justify-center gap-2 px-4 py-3 text-center text-sm text-muted-foreground" aria-disabled="true">
            Face-to-face <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
          </span>
        </div>

        {/* Language pills */}
        <div className="mt-5 flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background px-5 py-2.5 text-sm">
              <span aria-hidden>🇬🇧</span> English
            </span>
            <span className="text-lg text-muted-foreground" aria-hidden>→</span>
          </div>
          <label className="sr-only" htmlFor="demo-language">Translate into</label>
          <select
            id="demo-language"
            value={lang}
            disabled={running}
            onChange={(e) => setLang(e.target.value)}
            className="cursor-pointer appearance-none rounded-full border bg-background px-5 py-2.5 text-center text-sm disabled:opacity-60"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.code === "fr" ? "🇫🇷 " : "🇪🇸 "}{l.native}</option>
            ))}
          </select>
        </div>

        {/* Waveform panel */}
        <div className="mt-6 rounded-3xl border bg-secondary/30 px-5 pb-6 pt-8">
          <div className="flex h-20 items-end justify-center gap-1.5" aria-label="Microphone level" role="img">
            {levels.map((v, i) => (
              <span key={i} className="w-1.5 rounded-full bg-foreground/70 transition-[height] duration-75" style={{ height: `${Math.max(8, Math.round(v * 100))}%` }} />
            ))}
          </div>
          <p className="mt-6 text-center text-muted-foreground">
            {running
              ? (hearing ? `Hearing you. Speak English and hear ${target?.native ?? ""}.` : "Listening. Start speaking.")
              : "Speak, and hear yourself translated in real time."}
          </p>

          <div className="relative mt-6">
            {running ? (
              <button onClick={() => stopRef.current?.()} className="flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-4 text-base font-medium">
                <Square className="size-4" /> Stop
              </button>
            ) : (
              <button onClick={start} disabled={remaining <= 0} className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-base font-medium text-background disabled:opacity-50">
                <Play className="size-5" /> Try the live demo
              </button>
            )}
            {!running && (
              <span className="absolute -top-3 right-5 rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold tracking-wide text-white shadow">TRY IT — LIVE</span>
            )}
          </div>
        </div>

        {/* Footer row */}
        <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Zap className="size-3.5" /> Real-time</span>
          <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" /> {minutes}-minute free trial a day</span>
          <span className="inline-flex items-center gap-1.5"><Headphones className="size-3.5" /> Use headphones</span>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">{mm}:{ss} left today · Microphone on this device only</p>

        {status && (
          <p className="mt-4 text-center text-sm text-destructive">
            {status}{" "}
            {status.includes("free account") && <Link to="/auth" search={{ mode: "up" }} className="underline">Create an account</Link>}
          </p>
        )}

        {lines.length > 0 && (
          <div className="mt-6 space-y-3 border-t pt-6">
            {lines.map((l) => (
              <div key={l.index} className="rounded-2xl border bg-background p-4">
                <p className="text-sm text-muted-foreground">{l.english}</p>
                <p className="mt-1 font-display text-lg">{l.translation}</p>
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Speech is sent to our speech and translation providers while you speak, and is not kept after it is translated.
        </p>
      </div>
    </div>
  );
}
