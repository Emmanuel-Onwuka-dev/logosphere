import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Headphones, Square, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";
import { DEFAULT_SPEED, SPEED_MAX, SPEED_MIN, clampSpeed, delayStats, findCuts, growthPerHourMs, lengthPercent, reviewCsv, sectionStats, type Cut, type CutType, type ReviewRow } from "@/lib/interpretation";
import { timeStretch } from "@/lib/timestretch";
import { interpretPiece } from "@/lib/deepgram.functions";

type Lang = "fr" | "es";
type Mark = ReviewRow["mark"];
type Row = Cut & { status: "waiting" | "processing" | "ready" | "playing" | "played" | "failed"; audioStartMs: number | null; error: string | null; english: string; translation: string; speed: number; audioSeconds: number; retries: string[]; mark: Mark };
type Run = { rows: Row[]; done: boolean; recordingUrl: string | null };
const NAME: Record<Lang, string> = { fr: "French", es: "Spanish" };
const CUT_LABEL: Record<CutType, string> = { pause: "pause", extended: "extended to pause", forced: "forced 8 s" };
const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`);
const MAX_PENDING = 4;

/** Plays the source at 1× and each language's pieces strictly in number order, sped up without pitch change. */
export function AudibleDelayTest({ samples, url, disabled }: { samples: Float32Array; url: string; disabled: boolean }) {
  const interpret = useServerFn(interpretPiece);
  const [speed, setSpeed] = useState<Record<Lang, number>>({ ...DEFAULT_SPEED });
  const [runs, setRuns] = useState<Partial<Record<Lang, Run>>>({});
  const [running, setRunning] = useState<Lang | null>(null);
  const runId = useRef(0);
  const source = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const finish = useRef<(() => void) | null>(null);
  const totalSeconds = samples.length / PCM_SAMPLE_RATE;

  useEffect(() => () => { runId.current += 1; clearInterval(tick.current); void ctx.current?.close(); }, []);

  function stop() {
    runId.current += 1; clearInterval(tick.current); source.current?.pause();
    void ctx.current?.close(); ctx.current = null; setRunning(null);
    finish.current?.(); finish.current = null;
  }

  const setRun = (lang: Lang, f: (r: Run) => Run) => setRuns((all) => (all[lang] ? { ...all, [lang]: f(all[lang]!) } : all));
  const update = (lang: Lang, index: number, patch: Partial<Row>) => setRun(lang, (r) => ({ ...r, rows: r.rows.map((x) => (x.index === index ? { ...x, ...patch } : x)) }));

  /** Resolves when the last piece has played or the run is stopped. */
  async function runLanguage(lang: Lang, pieceSpeed: number) {
    const audio = source.current;
    if (!audio) return;
    stop();
    const id = runId.current;
    const cuts = findCuts(samples);
    const old = runs[lang]?.recordingUrl; if (old) URL.revokeObjectURL(old);
    setRuns((all) => ({ ...all, [lang]: { done: false, recordingUrl: null, rows: cuts.map((c) => ({ ...c, status: "waiting", audioStartMs: null, error: null, english: "", translation: "", speed: pieceSpeed, audioSeconds: 0, retries: [], mark: "" })) } }));
    setRunning(lang);
    const ac = new AudioContext(); ctx.current = ac;
    const tap = ac.createMediaStreamDestination();
    const recorder = new MediaRecorder(tap.stream); const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { if (chunks.length) { const u = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })); setRun(lang, (r) => ({ ...r, recordingUrl: u })); } };
    recorder.start();
    audio.currentTime = 0; audio.playbackRate = 1;
    try { await ac.resume(); await audio.play(); } catch { stop(); return; }
    const origin = performance.now() - audio.currentTime * 1000;
    const buffers = new Map<number, AudioBuffer>();
    let nextToPlay = 0; let playEnd = 0; let next = 0; let pending = 0;
    const ended = new Promise<void>((resolve) => { finish.current = resolve; });

    const drain = () => {
      while (id === runId.current && buffers.has(nextToPlay)) {
        const buffer = buffers.get(nextToPlay)!; buffers.delete(nextToPlay);
        const when = Math.max(ac.currentTime + 0.02, playEnd);
        const node = ac.createBufferSource(); node.buffer = buffer;
        node.connect(ac.destination); node.connect(tap); node.start(when);
        playEnd = when + buffer.duration;
        const index = nextToPlay;
        update(lang, index, { audioStartMs: Math.round(performance.now() + (when - ac.currentTime) * 1000 - origin), status: "playing", audioSeconds: buffer.duration });
        node.onended = () => {
          if (id !== runId.current) return;
          setRun(lang, (r) => ({ ...r, rows: r.rows.map((x) => (x.index === index && x.status === "playing" ? { ...x, status: "played" } : x)) }));
          if (index === cuts.length - 1) {
            recorder.stop(); clearInterval(tick.current); audio.pause();
            setRun(lang, (r) => ({ ...r, done: true })); setRunning(null);
            finish.current?.(); finish.current = null;
          }
        };
        nextToPlay += 1;
      }
    };
    const silence = (seconds: number) => ac.createBuffer(1, Math.max(1, Math.round(seconds * ac.sampleRate)), ac.sampleRate);
    // Speed is applied to each piece before it is queued; pitch is kept by WSOLA time-stretching.
    const stretch = (b: AudioBuffer) => {
      if (pieceSpeed === 1) return b;
      const data = timeStretch(b.getChannelData(0), b.sampleRate, pieceSpeed);
      const out = ac.createBuffer(1, data.length, b.sampleRate); out.copyToChannel(data, 0); return out;
    };

    const pump = () => {
      if (id !== runId.current) return;
      while (next < cuts.length && audio.currentTime + 0.05 >= cuts[next]!.startSeconds && pending < MAX_PENDING) {
        const cut = cuts[next++]!; pending += 1;
        update(lang, cut.index, { status: "processing" });
        const pcm = samples.subarray(Math.round(cut.startSeconds * PCM_SAMPLE_RATE), Math.round(cut.endSeconds * PCM_SAMPLE_RATE));
        const length = cut.endSeconds - cut.startSeconds;
        void interpret({ data: { audioBase64: toBase64(encodeWav(pcm)), targetLanguage: lang } })
          .then(async (r) => {
            if (id !== runId.current) return;
            for (const m of r.retries ?? []) console.warn(`piece ${cut.index + 1} retried after dropped connection:`, m);
            if (r.error || !r.audioBase64) {
              if (r.error) console.error(`piece ${cut.index + 1} failed:`, r.error);
              update(lang, cut.index, { status: r.error ? "failed" : "ready", error: r.error, english: r.transcript, translation: r.translation, retries: r.retries ?? [] });
              buffers.set(cut.index, silence(length));
            } else {
              const bytes = Uint8Array.from(atob(r.audioBase64), (c) => c.charCodeAt(0));
              buffers.set(cut.index, stretch(await ac.decodeAudioData(bytes.buffer)));
              update(lang, cut.index, { status: "ready", english: r.transcript, translation: r.translation, retries: r.retries ?? [] });
            }
          })
          .catch((e: unknown) => {
            if (id !== runId.current) return;
            const message = e instanceof Error ? e.message : "Request failed";
            console.error(`piece ${cut.index + 1} failed:`, message);
            update(lang, cut.index, { status: "failed", error: message });
            buffers.set(cut.index, silence(length));
          })
          .finally(() => { pending -= 1; drain(); });
      }
    };
    pump(); tick.current = setInterval(pump, 100);
    await ended;
  }

  async function runBoth() {
    const id = runId.current;
    await runLanguage("fr", speed.fr);
    if (runId.current !== id + 1) return; // stopped by the user
    await runLanguage("es", speed.es);
  }

  function downloadCsv() {
    const rows: ReviewRow[] = (["fr", "es"] as const).flatMap((lang) => (runs[lang]?.rows ?? []).map((r) => ({ language: lang, piece: r.index + 1, cutType: r.type, english: r.english, translation: r.translation, mark: r.mark })));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([reviewCsv(rows)], { type: "text/csv;charset=utf-8" }));
    a.download = "native-speaker-review.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const hasRows = Object.values(runs).some((r) => r?.rows.length);
  return (
    <section className="min-w-0 border-t pt-6">
      <h2 className="font-display text-xl">Audible delay · French and Spanish audio</h2>
      <p className="mt-1 text-sm text-muted-foreground">Plays the English at normal speed and each language's pieces in number order. Cuts land on pauses; without one within 2 s, a piece extends to the next pause within 4 s, else it is forced at 8 s.</p>
      <audio ref={source} src={url} className="hidden" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["fr", "es"] as const).map((lang) => (
          <label key={lang} className="flex items-center gap-3 text-sm">
            <span className="w-16">{NAME[lang]}</span>
            <input type="range" min={SPEED_MIN} max={SPEED_MAX} step={0.01} value={speed[lang]} disabled={running !== null} aria-label={`${NAME[lang]} playback speed`}
              onChange={(e) => setSpeed((s) => ({ ...s, [lang]: clampSpeed(Number(e.target.value)) }))} className="flex-1 accent-primary" />
            <span className="w-12 tabular-nums">{speed[lang].toFixed(2)}×</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled || running !== null} onClick={() => void runLanguage("fr", speed.fr)}><Headphones />French</Button>
        <Button variant="outline" disabled={disabled || running !== null} onClick={() => void runLanguage("es", speed.es)}><Headphones />Spanish</Button>
        <Button variant="outline" disabled={disabled || running !== null} onClick={() => void runBoth()}><Headphones />French, then Spanish</Button>
        {running && <Button variant="outline" onClick={stop}><Square />Stop</Button>}
        {hasRows && <Button variant="outline" onClick={downloadCsv}><FileSpreadsheet />Review CSV</Button>}
      </div>
      {(["fr", "es"] as const).map((lang) => {
        const run = runs[lang]; if (!run) return null;
        const measured = run.rows.filter((r) => r.audioStartMs !== null && !r.error);
        const delays = measured.map((r) => ({ speechStartSeconds: r.startSeconds, delayMs: r.audioStartMs! - r.startSeconds * 1000 }));
        const all = run.done ? delayStats(delays.map((d) => d.delayMs)) : null;
        const parts = run.done ? sectionStats(delays, totalSeconds) : null;
        const audioSeconds = run.rows.reduce((a, r) => a + r.audioSeconds, 0);
        const failed = run.rows.filter((r) => r.status === "failed");
        const forced = run.rows.filter((r) => r.type === "forced").length;
        const playedSpeed = run.rows[0]?.speed ?? speed[lang];
        return (
          <div key={lang} className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-lg">{NAME[lang]}</h3>
              <span className="rounded border px-2 py-0.5 text-xs tabular-nums">speed {playedSpeed.toFixed(2)}×</span>
              {run.recordingUrl && <><audio controls src={run.recordingUrl} className="h-8 max-w-full" /><Button size="sm" variant="outline" asChild><a href={run.recordingUrl} download={`${lang}-output.webm`}><Download />Translated audio</a></Button></>}
            </div>
            {failed.map((r) => <p key={r.index} role="alert" className="mt-2 break-words text-sm text-destructive">Piece {r.index + 1} failed — played {(r.endSeconds - r.startSeconds).toFixed(1)} s of silence. {r.error}</p>)}
            {all && parts && (
              <div className="mt-2 space-y-1 text-sm tabular-nums">
                <p>Overall average {sec(all.averageMs)} · min {sec(all.minMs)} · max {sec(all.maxMs)} · change start→end {all.changeMs >= 0 ? "+" : ""}{sec(all.changeMs)} · per hour {growthPerHourMs(all.changeMs, totalSeconds) >= 0 ? "+" : ""}{sec(growthPerHourMs(all.changeMs, totalSeconds))}</p>
                {(["first", "middle", "last"] as const).map((k) => <p key={k}>{k === "first" ? "First 3 min" : k === "last" ? "Last 3 min" : "Middle"}: average {sec(parts[k]?.averageMs)} · min {sec(parts[k]?.minMs)} · max {sec(parts[k]?.maxMs)}</p>)}
                <p>Audio length {audioSeconds.toFixed(1)} s for {totalSeconds.toFixed(1)} s of speech ({lengthPercent(audioSeconds, totalSeconds)}%) · forced cuts {forced} · failed pieces {failed.length}</p>
              </div>
            )}
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><caption className="sr-only">{NAME[lang]} audible delay per piece</caption>
              <thead className="text-muted-foreground"><tr className="border-b"><th className="py-2">Piece</th><th>Cut</th><th>Speech starts</th><th>Audio starts</th><th>Delay</th><th>Speed</th><th>Status</th><th className="w-1/3">Translation</th><th>Review</th></tr></thead>
              <tbody className="tabular-nums">{run.rows.map((r) => (
                <tr key={r.index} className="border-b align-top">
                  <td className="py-2">{r.index + 1}</td>
                  <td className={r.type === "forced" ? "py-2 font-medium text-destructive" : "py-2"}>{r.startSeconds.toFixed(2)}–{r.endSeconds.toFixed(2)} s · {CUT_LABEL[r.type]}</td>
                  <td className="py-2">{r.startSeconds.toFixed(2)} s</td>
                  <td className="py-2">{sec(r.audioStartMs)}</td>
                  <td className="py-2">{r.audioStartMs === null ? "—" : sec(r.audioStartMs - r.startSeconds * 1000)}</td>
                  <td className="py-2">{r.speed.toFixed(2)}×</td>
                  <td className={r.status === "failed" ? "py-2 text-destructive" : "py-2"}>{r.status}{r.retries.length ? ` · retried ${r.retries.length}` : ""}</td>
                  <td className="break-words py-2">{r.translation}</td>
                  <td className="py-2"><select aria-label={`Review piece ${r.index + 1}`} value={r.mark} onChange={(e) => update(lang, r.index, { mark: e.target.value as Mark })} className="rounded border bg-background px-1 py-0.5"><option value="">—</option><option value="acceptable">acceptable</option><option value="not acceptable">not acceptable</option></select></td>
                </tr>))}</tbody></table></div>
          </div>
        );
      })}
    </section>
  );
}
