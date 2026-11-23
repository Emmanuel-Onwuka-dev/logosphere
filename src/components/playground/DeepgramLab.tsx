import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Upload, Play, Radio, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { decodeAudio } from "@/lib/audio.browser";
import { DEFAULT_TARGET, DEEPGRAM_VOICES, PCM_SAMPLE_RATE, PIECE_SECONDS, delayTrend, encodeWav, toBase64, validateDuration, type PieceResult } from "@/lib/deepgram";
import { AudibleDelayTest } from "@/components/playground/AudibleDelayTest";
import { transcribeDeepgram, translateDeepgramText, speakDeepgram } from "@/lib/deepgram.functions";

type Clip = { blob: Blob; name: string; url: string; samples: Float32Array; durationSeconds: number };
type Transcript = Awaited<ReturnType<typeof transcribeDeepgram>>;
type Translation = Awaited<ReturnType<typeof translateDeepgramText>>;
type Speech = Awaited<ReturnType<typeof speakDeepgram>>;
type Target = "fr" | "es" | "pt";
const ms = (n: number | null | undefined) => n == null ? "—" : `${Math.round(n).toLocaleString()} ms`;

export function DeepgramLab() {
  const transcribe = useServerFn(transcribeDeepgram);
  const translate = useServerFn(translateDeepgramText);
  const speak = useServerFn(speakDeepgram);
  const [clip, setClip] = useState<Clip | null>(null);
  const [target, setTarget] = useState<Target>(DEFAULT_TARGET);
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [speech, setSpeech] = useState<Speech | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [pieces, setPieces] = useState<PieceResult[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [streamComplete, setStreamComplete] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const runId = useRef(0);
  const player = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; runId.current += 1;
      clearInterval(tick.current); clearTimeout(limitTimer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      mic.current?.getTracks().forEach((track) => track.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  async function takeClip(blob: Blob, name: string) {
    if (!mounted.current) return;
    if (blob.size > 60 * 1024 * 1024) { toast.error("Upload a WAV or MP3 under 60 MB"); return; }
    setPreparing(true);
    try {
      const decoded = await decodeAudio(blob);
      validateDuration(decoded.durationSeconds, "long");
      if (!mounted.current) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      setClip({ blob, name, url, ...decoded });
      setTranscript(null); setTranslation(null); setSpeech(null); setTotalMs(null); setError(null); setPieces([]); setStreamComplete(false); setElapsed(0);
    } catch (e) { toast.error(e instanceof Error ? e.message : "This audio could not be read"); }
    finally { if (mounted.current) setPreparing(false); }
  }

  async function toggleMic() {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mic.current = stream;
      if (!mounted.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => {
        clearTimeout(limitTimer.current); stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        setRecording(false); void takeClip(new Blob(chunks, { type: rec.mimeType }), "English recording");
      };
      recorder.current = rec; rec.start(); setRecording(true);
      limitTimer.current = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 119000);
    } catch { mic.current?.getTracks().forEach((track) => track.stop()); toast.error("Microphone access was blocked"); }
  }

  async function runClip() {
    if (!clip) return;
    try { validateDuration(clip.durationSeconds, "clip"); } catch (e) { toast.error(e instanceof Error ? e.message : "Clip is too long"); return; }
    const id = ++runId.current;
    const started = performance.now();
    setBusy(true); setError(null); setTranscript(null); setTranslation(null); setSpeech(null); setTotalMs(null);
    try {
      setStage("Listening to English…");
      const heard = await transcribe({ data: { audioBase64: toBase64(encodeWav(clip.samples)), mode: "clip" } });
      if (id !== runId.current) return;
      setTranscript(heard); setStage("Translating…");
      const translated = await translate({ data: { text: heard.transcript, targetLanguage: target } });
      if (id !== runId.current) return;
      setTranslation(translated);
      if (target !== "pt") {
        setStage("Generating speech…");
        const spoken = await speak({ data: { text: translated.text, targetLanguage: target } });
        if (id !== runId.current) return;
        setSpeech(spoken);
      }
    } catch (e) { if (id === runId.current) setError(e instanceof Error ? e.message : "Deepgram test failed"); }
    finally { if (id === runId.current) { setBusy(false); setStage(""); setTotalMs(performance.now() - started); } }
  }

  function stopStream() {
    runId.current += 1; clearInterval(tick.current); player.current?.pause();
    setStreaming(false); setStreamComplete(false);
  }

  async function streamFile() {
    if (!clip || !player.current) return;
    try { validateDuration(clip.durationSeconds, "continuous"); } catch (e) { toast.error(e instanceof Error ? e.message : "File is too long"); return; }
    const id = ++runId.current;
    setPieces([]); setStreamComplete(false); setElapsed(0); setError(null); setStreaming(true);
    const audio = player.current;
    audio.currentTime = 0; audio.playbackRate = 1;
    try { await audio.play(); } catch { setStreaming(false); setError("The audio could not start playing"); return; }
    const origin = performance.now() - audio.currentTime * 1000;
    const count = Math.ceil(clip.durationSeconds / PIECE_SECONDS);
    let next = 0; let pending = 0; let completed = 0;
    const pump = () => {
      if (id !== runId.current) return;
      setElapsed(Math.min(clip.durationSeconds, audio.currentTime));
      // Bound concurrency without assuming each piece finishes in eight seconds.
      while (next < count && audio.currentTime + 0.05 >= next * PIECE_SECONDS && pending < 3) {
        const index = next++; pending += 1;
        const startSeconds = index * PIECE_SECONDS;
        const samples = clip.samples.subarray(index * PIECE_SECONDS * PCM_SAMPLE_RATE, (index + 1) * PIECE_SECONDS * PCM_SAMPLE_RATE);
        const durationSeconds = samples.length / PCM_SAMPLE_RATE;
        const spokenAt = origin + startSeconds * 1000;
        const base: PieceResult = { index, startSeconds, durationSeconds, transcript: "", firstPartialMs: null, finalTextMs: null, displayDelayMs: null, error: null, completed: false };
        setPieces((rows) => [...rows, base]);
        void transcribe({ data: { audioBase64: toBase64(encodeWav(samples)), mode: "piece" } }).then((heard) => {
          if (id !== runId.current) return;
          const result = { ...base, transcript: heard.transcript, firstPartialMs: heard.firstPartialMs, finalTextMs: heard.finalTextMs, displayDelayMs: heard.transcript ? Math.round(performance.now() - spokenAt) : null, completed: true };
          setPieces((rows) => rows.map((row) => row.index === index ? result : row));
        }).catch((e: unknown) => {
          if (id !== runId.current) return;
          setPieces((rows) => rows.map((row) => row.index === index ? { ...base, error: e instanceof Error ? e.message : "Transcription failed", completed: true } : row));
          // Do not keep spending on automatic calls after a provider failure.
          next = count; audio.pause();
        }).finally(() => {
          if (id !== runId.current) return;
          pending -= 1; completed += 1;
          if (next === count && pending === 0) {
            clearInterval(tick.current); setStreaming(false); setStreamComplete(completed === count); audio.pause();
          }
        });
      }
    };
    pump(); tick.current = setInterval(pump, 100);
  }

  const locked = busy || streaming || recording || preparing;
  const trend = delayTrend(pieces, clip?.durationSeconds ?? 0);
  return (
    <div className="grid min-w-0 gap-8 py-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="min-w-0 space-y-5">
        <h2 className="font-display text-2xl">Deepgram speech test</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="dg-source">From</Label><select id="dg-source" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value="en" disabled><option value="en">English</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="dg-target">To</Label><select id="dg-target" value={target} disabled={locked} onChange={(e) => { const value = e.target.value; if (value === "fr" || value === "es" || value === "pt") { setTarget(value); setTranslation(null); setSpeech(null); setTranscript(null); setTotalMs(null); setError(null); } }} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{TARGET_LANGUAGES.map((l) => <option key={l.code} value={l.code} disabled={l.status === "paused"}>{l.name}{l.status === "paused" ? " — paused" : ""}</option>)}</select></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy || streaming || preparing} onClick={() => void toggleMic()}>{recording ? <Square /> : <Mic />}{recording ? "Stop recording" : "Record"}</Button>
          <Button variant="outline" className="flex-1" disabled={locked} onClick={() => fileInput.current?.click()}><Upload />Upload</Button>
          <input ref={fileInput} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" className="hidden" aria-label="Upload English WAV or MP3" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; if (!/\.(wav|mp3)$/i.test(file.name)) { toast.error("Choose a WAV or MP3 file"); return; } void takeClip(file, file.name); }} />
        </div>
        {preparing && <p className="text-sm text-muted-foreground">Reading audio…</p>}
        {clip && <div><p className="break-words text-sm">{clip.name}</p><p className="text-xs text-muted-foreground">{clip.durationSeconds.toFixed(2)} seconds · English</p><audio ref={player} src={clip.url} controls={!streaming} className="mt-2 w-full" /></div>}
        <Button className="w-full" disabled={locked || !clip || clip.durationSeconds >= 120} onClick={() => void runClip()}>{busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Play />}{busy ? "Running test…" : "Run clip test"}</Button>
        {clip && clip.durationSeconds >= 120 && <p className="text-sm text-muted-foreground">This recording is for the continuous test; clip tests require under 2 minutes.</p>}
        {target === "pt" && <p className="text-sm text-muted-foreground">Portuguese: transcription and translation only. No Aura-2 voice is offered.</p>}
        <div className="border-t pt-5">
          <h3 className="font-display text-lg">Continuous English speech</h3>
          <div className="mt-3 flex gap-2"><Button variant="outline" className="flex-1" disabled={!clip || busy || recording || preparing || streaming} onClick={() => void streamFile()}><Radio />Stream file · 1×</Button>{streaming && <Button variant="outline" size="icon" title="Stop streaming" aria-label="Stop streaming" onClick={stopStream}><Square /></Button>}</div>
          {(streaming || pieces.length > 0) && <p className="mt-2 text-sm tabular-nums text-muted-foreground">{elapsed.toFixed(1)} / {clip?.durationSeconds.toFixed(1)} s · {pieces.filter((r) => r.completed).length} / {Math.ceil((clip?.durationSeconds ?? 0) / PIECE_SECONDS)} pieces</p>}
        </div>
      </section>
      <div className="min-w-0 space-y-8">
        <section className="space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-2xl">Clip results</h2><span className="text-sm tabular-nums">Total {ms(totalMs)}</span></div>
          {stage && <p className="text-sm text-muted-foreground">{stage}</p>}
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          {transcript && <div><h3 className="text-sm font-medium">English transcript · Nova-3</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{transcript.transcript}</p></div>}
          {translation && <div><h3 className="text-sm font-medium">{TARGET_LANGUAGES.find((l) => l.code === target)?.name} translation</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{translation.text}</p><p className="mt-2 break-words text-xs text-muted-foreground">{translation.model}</p></div>}
          {speech && <div><p className="break-words text-xs text-muted-foreground">{speech.voice}</p><audio controls src={`data:${speech.mimeType};base64,${speech.audioBase64}`} className="mt-2 w-full" /></div>}
          <div className="overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm"><caption className="sr-only">Per-step timing breakdown</caption><thead><tr className="border-b text-muted-foreground"><th className="py-2 font-medium">Step</th><th className="px-2 py-2 font-medium">First result</th><th className="py-2 text-right font-medium">Complete</th></tr></thead><tbody className="tabular-nums"><tr className="border-b"><td className="py-3">Nova-3 · English</td><td className="px-2">{ms(transcript?.firstPartialMs)}</td><td className="text-right">{ms(transcript?.finalTextMs)}</td></tr><tr className="border-b"><td className="py-3">Translation</td><td className="px-2">—</td><td className="text-right">{ms(translation?.durationMs)}</td></tr><tr><td className="py-3">Aura-2 · {DEEPGRAM_VOICES[target] ? target.toUpperCase() : "Not offered"}</td><td className="px-2">{ms(speech?.firstAudioMs)}</td><td className="text-right">{ms(speech?.durationMs)}</td></tr></tbody></table></div>
          {transcript && <p className="text-xs text-muted-foreground">First partial and final text are timed at the server. First audio excludes the WAV header. Total includes upload, conversion and return to this page. {transcript.firstPartialMs === null ? "Deepgram emitted no partial text for this clip." : ""}</p>}
        </section>
        <section className="min-w-0 border-t pt-6">
          <h2 className="font-display text-xl">Continuous test · 8-second pieces</h2>
          {pieces.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[740px] text-left text-xs"><caption className="sr-only">Continuous transcription timings</caption><thead className="text-muted-foreground"><tr className="border-b"><th className="py-2">Piece</th><th>Speech starts</th><th>First partial</th><th>Final text</th><th>Text on page</th><th className="w-2/5">Transcript</th></tr></thead><tbody>{pieces.map((r) => <tr key={r.index} className="border-b align-top"><td className="py-3">{r.index + 1}</td><td className="py-3 tabular-nums">{r.startSeconds} s</td><td className="py-3 tabular-nums">{ms(r.firstPartialMs)}</td><td className="py-3 tabular-nums">{ms(r.finalTextMs)}</td><td className="py-3 tabular-nums">{ms(r.displayDelayMs)}</td><td className={`break-words py-3 ${r.error ? "text-destructive" : ""}`}>{r.error ?? (r.transcript || (r.completed ? "No speech detected" : "Listening…"))}</td></tr>)}</tbody></table></div>}
          {pieces.length > 0 && <p className="mt-3 text-sm">{streaming ? "Test in progress…" : !streamComplete || trend.verdict === "incomplete" ? "Delay trend: inconclusive — a complete recording of at least three minutes with all pieces successful is required." : trend.verdict === "growing" ? `Delay grows · estimated drift +${ms(trend.growthMs)} over this recording.` : `No growing delay detected · estimated drift ${ms(trend.growthMs)} over this recording.`}</p>}
          {pieces.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Text-on-page delay starts at each piece’s first spoken sample and includes playback pacing, queuing and return to this page. This measures English transcription, not translated audio. Each piece opens a separate Nova-3 stream.</p>}
        </section>
        {clip && <AudibleDelayTest samples={clip.samples} url={clip.url} disabled={busy || streaming || recording || preparing} />}
      </div>
    </div>
  );
}