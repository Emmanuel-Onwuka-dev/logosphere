import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Headphones, Square, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PCM_SAMPLE_RATE, encodeWav, toBase64 } from "@/lib/deepgram";
import { findCuts, delayStats, type Cut } from "@/lib/interpretation";
import { interpretPiece } from "@/lib/deepgram.functions";

type Row = Cut & { status: "waiting" | "processing" | "ready" | "playing" | "played" | "failed"; audioStartMs: number | null; error: string | null; translation: string };
const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`);
const MAX_PENDING = 4;

/** Plays the source at 1× and the translated pieces strictly in number order, measuring when each is heard. */
export function AudibleDelayTest({ samples, url, target, disabled }: { samples: Float32Array; url: string; target: "fr" | "es"; disabled: boolean }) {
  const interpret = useServerFn(interpretPiece);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const runId = useRef(0);
  const source = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => { runId.current += 1; clearInterval(tick.current); void ctx.current?.close(); }, []);

  function stop() {
    runId.current += 1; clearInterval(tick.current); source.current?.pause();
    void ctx.current?.close(); ctx.current = null; setRunning(false);
  }

  async function start() {
    const audio = source.current;
    if (!audio) return;
    stop();
    const id = runId.current;
    const cuts = findCuts(samples);
    setRows(cuts.map((c) => ({ ...c, status: "waiting", audioStartMs: null, error: null, translation: "" })));
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null); setRunning(true);
    const ac = new AudioContext(); ctx.current = ac;
    const tap = ac.createMediaStreamDestination();
    const recorder = new MediaRecorder(tap.stream); const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { if (chunks.length) setRecordingUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }))); };
    recorder.start();
    audio.currentTime = 0;
    try { await ac.resume(); await audio.play(); } catch { stop(); return; }
    const origin = performance.now() - audio.currentTime * 1000;
    const buffers = new Map<number, AudioBuffer>();
    let nextToPlay = 0; let playEnd = 0; let next = 0; let pending = 0;
    const update = (index: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.index === index ? { ...r, ...patch } : r)));

    // Strict order: only the next numbered piece may be queued; it starts when the previous ends.
    const drain = () => {
      while (id === runId.current && buffers.has(nextToPlay)) {
        const buffer = buffers.get(nextToPlay)!; buffers.delete(nextToPlay);
        const when = Math.max(ac.currentTime + 0.02, playEnd);
        const node = ac.createBufferSource(); node.buffer = buffer;
        node.connect(ac.destination); node.connect(tap); node.start(when);
        playEnd = when + buffer.duration;
        const index = nextToPlay;
        update(index, { audioStartMs: Math.round(performance.now() + (when - ac.currentTime) * 1000 - origin), status: "playing" });
        node.onended = () => {
          if (id !== runId.current) return;
          setRows((rs) => rs.map((r) => (r.index === index && r.status === "playing" ? { ...r, status: "played" } : r)));
          if (index === cuts.length - 1) { recorder.stop(); clearInterval(tick.current); setRunning(false); }
        };
        nextToPlay += 1;
      }
    };
    const silence = (seconds: number) => ac.createBuffer(1, Math.max(1, Math.round(seconds * ac.sampleRate)), ac.sampleRate);

    const pump = () => {
      if (id !== runId.current) return;
      while (next < cuts.length && audio.currentTime + 0.05 >= cuts[next]!.startSeconds && pending < MAX_PENDING) {
        const cut = cuts[next++]!; pending += 1;
        update(cut.index, { status: "processing" });
        const pcm = samples.subarray(Math.round(cut.startSeconds * PCM_SAMPLE_RATE), Math.round(cut.endSeconds * PCM_SAMPLE_RATE));
        const length = cut.endSeconds - cut.startSeconds;
        void interpret({ data: { audioBase64: toBase64(encodeWav(pcm)), targetLanguage: target } })
          .then(async (r) => {
            if (id !== runId.current) return;
            if (r.error || !r.audioBase64) {
              if (r.error) console.error(`piece ${cut.index + 1} failed:`, r.error);
              update(cut.index, { status: r.error ? "failed" : "ready", error: r.error, translation: r.translation });
              buffers.set(cut.index, silence(length));
            } else {
              const bytes = Uint8Array.from(atob(r.audioBase64), (c) => c.charCodeAt(0));
              buffers.set(cut.index, await ac.decodeAudioData(bytes.buffer));
              update(cut.index, { status: "ready", translation: r.translation });
            }
          })
          .catch((e: unknown) => {
            if (id !== runId.current) return;
            const message = e instanceof Error ? e.message : "Request failed";
            console.error(`piece ${cut.index + 1} failed:`, message);
            update(cut.index, { status: "failed", error: message });
            buffers.set(cut.index, silence(length));
          })
          .finally(() => { pending -= 1; drain(); });
      }
    };
    pump(); tick.current = setInterval(pump, 100);
  }

  const heard = rows.filter((r) => r.audioStartMs !== null && !r.error).map((r) => r.audioStartMs! - r.startSeconds * 1000);
  const stats = !running && heard.length ? delayStats(heard) : null;
  const failed = rows.filter((r) => r.status === "failed");
  return (
    <section className="min-w-0 border-t pt-6">
      <h2 className="font-display text-xl">Audible delay · {target === "fr" ? "French" : "Spanish"} audio</h2>
      <p className="mt-1 text-sm text-muted-foreground">Plays the English at normal speed and the translated pieces in number order, cut at natural pauses.</p>
      <audio ref={source} src={url} className="hidden" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled || running} onClick={() => void start()}><Headphones />Run audible delay test</Button>
        {running && <Button variant="outline" onClick={stop}><Square />Stop</Button>}
        {recordingUrl && <Button variant="outline" asChild><a href={recordingUrl} download={`${target}-output.webm`}><Download />Translated audio</a></Button>}
      </div>
      {failed.map((r) => <p key={r.index} role="alert" className="mt-2 break-words text-sm text-destructive">Piece {r.index + 1} failed — played {(r.endSeconds - r.startSeconds).toFixed(1)} s of silence. {r.error}</p>)}
      {stats && <p className="mt-3 text-sm tabular-nums">Average {sec(stats.averageMs)} · min {sec(stats.minMs)} · max {sec(stats.maxMs)} · change start→end {stats.changeMs >= 0 ? "+" : ""}{sec(stats.changeMs)}</p>}
      {rows.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><caption className="sr-only">Audible delay per piece</caption><thead className="text-muted-foreground"><tr className="border-b"><th className="py-2">Piece</th><th>Cut</th><th>Speech starts</th><th>Audio starts</th><th>Delay</th><th>Status</th><th className="w-2/5">Translation</th></tr></thead>
        <tbody className="tabular-nums">{rows.map((r) => <tr key={r.index} className="border-b align-top"><td className="py-2">{r.index + 1}</td><td className="py-2">{r.startSeconds.toFixed(2)}–{r.endSeconds.toFixed(2)} s · {r.atPause ? "pause" : "8 s mark"}</td><td className="py-2">{r.startSeconds.toFixed(2)} s</td><td className="py-2">{sec(r.audioStartMs)}</td><td className="py-2">{r.audioStartMs === null ? "—" : sec(r.audioStartMs - r.startSeconds * 1000)}</td><td className={r.status === "failed" ? "py-2 text-destructive" : "py-2"}>{r.status === "failed" ? "failed" : r.status}</td><td className="break-words py-2">{r.translation}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
