import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, RotateCcw, Save, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { TARGET_LANGUAGES, TESTED_LANGUAGE_CODES } from "@/lib/languages";
import { encodeWavAt, placeClips } from "@/lib/wav";
import { getSermon, saveTranscript, setSermonTargets, translateSegment, startTranscription, setArchived, deleteSermon } from "@/lib/sermons.functions";

export const Route = createFileRoute("/_authenticated/recordings/$id")({
  head: () => ({ meta: [{ title: "Sermon — Logosphere" }] }),
  component: SermonWorkspace,
});

const CONCURRENCY = 3;
const DOWNLOAD_RATE = 24000;

async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]!; await task(item); }
  }));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const langName = (c: string) => TARGET_LANGUAGES.find((l) => l.code === c)?.name ?? c;

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SermonWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchSermon = useServerFn(getSermon);
  const save = useServerFn(saveTranscript);
  const setTargets = useServerFn(setSermonTargets);
  const translate = useServerFn(translateSegment);
  const retry = useServerFn(startTranscription);
  const archive = useServerFn(setArchived);
  const remove = useServerFn(deleteSermon);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sermon", id],
    queryFn: () => fetchSermon({ data: { recordingId: id } }),
    refetchInterval: (q) => (q.state.data?.recording.transcriptStatus === "transcribing" ? 5000 : false),
  });

  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => { if (data) setSelected(data.recording.targets); }, [data?.recording.id]);

  const dirty = useMemo(() => {
    if (!data) return [];
    return data.segments.filter((s) => edits[s.idx] !== undefined && edits[s.idx] !== (s.edited ?? s.original)).map((s) => ({ idx: s.idx, text: edits[s.idx]! }));
  }, [data, edits]);

  async function saveEdits() {
    if (dirty.length === 0) return;
    setBusy("Saving transcript…");
    try {
      await save({ data: { recordingId: id, edits: dirty } });
      setEdits({});
      toast.success("Transcript saved");
      await refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(null); }
  }

  async function toggleTarget(code: string) {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    if (next.length === 0) { toast.error("Choose at least one language"); return; }
    setSelected(next);
    try { await setTargets({ data: { recordingId: id, targets: next as ("fr" | "es")[] } }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not change languages"); }
  }

  async function translateAll() {
    if (!data) return;
    const segments = data.segments;
    if (dirty.length) await saveEdits();
    setBusy("Translating…");
    try {
      for (const lang of selected as ("fr" | "es")[]) {
        let done = 0;
        setProgress((p) => ({ ...p, [lang]: `0 of ${segments.length}` }));
        await pool(segments, CONCURRENCY, async (s) => {
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try { await translate({ data: { recordingId: id, language: lang, idx: s.idx } }); ok = true; } catch { ok = false; }
          }
          if (!ok) toast.error(`Segment ${s.idx + 1} could not be translated into ${langName(lang)}`);
          done += 1;
          setProgress((p) => ({ ...p, [lang]: `${done} of ${segments.length}` }));
        });
      }
      toast.success("Translation ready");
      await qc.invalidateQueries({ queryKey: ["sermon", id] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Translation stopped"); }
    finally { setBusy(null); setProgress({}); }
  }

  async function downloadAudio(lang: string) {
    if (!data) return;
    const pieces = data.pieces.filter((p) => p.language === lang && p.url).sort((a, b) => a.index - b.index);
    if (pieces.length === 0) { toast.error("No translated audio yet"); return; }
    setBusy(`Preparing ${langName(lang)} audio…`);
    const ctx = new AudioContext();
    try {
      const clips = [];
      for (const p of pieces) {
        const res = await fetch(p.url!);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        clips.push({ start: p.start, samples: buf.getChannelData(0), rate: buf.sampleRate });
      }
      const wav = encodeWavAt(placeClips(clips, DOWNLOAD_RATE), DOWNLOAD_RATE);
      download(`${data.recording.title} (${lang}).wav`, new Blob([wav as BlobPart], { type: "audio/wav" }));
    } catch { toast.error("Could not prepare the audio download"); }
    finally { void ctx.close(); setBusy(null); }
  }

  function downloadTranscript() {
    if (!data) return;
    const lines = data.segments.map((s) => `[${mmss(s.start)}] ${(s.edited ?? s.original).trim()}`);
    download(`${data.recording.title} (transcript).txt`, new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
  }

  async function toggleArchive() {
    if (!data) return;
    setBusy("Updating…");
    try { await archive({ data: { recordingId: id, archived: !data.recording.archived } }); await refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update"); }
    finally { setBusy(null); }
  }

  async function deleteThis() {
    if (!confirm("Delete this sermon, its audio and its transcript? This cannot be undone.")) return;
    setBusy("Deleting…");
    try { await remove({ data: { recordingId: id } }); toast.success("Sermon deleted"); navigate({ to: "/library" }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); setBusy(null); }
  }

  async function retryTranscript() {
    setBusy("Transcribing…");
    try { await retry({ data: { recordingId: id } }); toast.success("Transcript ready"); await refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Transcription failed"); }
    finally { setBusy(null); }
  }

  if (isLoading || !data) return <AppShell active="Recorded Sermons"><p className="text-muted-foreground">Loading…</p></AppShell>;
  const r = data.recording;
  const translatedLangs = [...new Set(data.pieces.map((p) => p.language))];

  return (
    <AppShell active="Recorded Sermons">
      <Link to="/recordings" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> Recorded sermons</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">{r.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{[r.preacher, r.sermonDate, r.durationSeconds ? mmss(r.durationSeconds) : null].filter(Boolean).join(" · ") || "Details not set"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-secondary px-3 py-1">Transcript: {r.transcriptStatus}</span>
            <span className="rounded-full bg-secondary px-3 py-1">Translations: {translatedLangs.length ? translatedLangs.map(langName).join(", ") : "none yet"}</span>
            {r.archived && <span className="rounded-full bg-secondary px-3 py-1">Archived</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={toggleArchive} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm disabled:opacity-50">
            {r.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {r.archived ? "Restore" : "Archive"}
          </button>
          <button onClick={deleteThis} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-50"><Trash2 className="size-4" /> Delete</button>
        </div>
      </div>

      {r.sourceUrl && <audio controls preload="metadata" src={r.sourceUrl} className="mt-6 w-full" aria-label="Original sermon audio" />}

      {r.transcriptStatus === "failed" && (
        <div className="mt-6 rounded-2xl border border-destructive p-5 text-sm">
          <p className="text-destructive">Transcription failed{r.transcriptError ? `: ${r.transcriptError}` : "."}</p>
          <button onClick={retryTranscript} disabled={!!busy} className="mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm"><RotateCcw className="size-4" /> Try transcribing again</button>
        </div>
      )}
      {r.transcriptStatus === "transcribing" && <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Transcribing. This page updates when it is ready.</p>}

      {data.segments.length > 0 && (
        <section className="mt-10 rounded-3xl border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Transcript</h2>
              <p className="text-xs text-muted-foreground">Correct any mistakes, then save. Translation uses your corrected text.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadTranscript} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm"><Download className="size-4" /> Transcript (.txt)</button>
              <button onClick={saveEdits} disabled={dirty.length === 0 || !!busy} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"><Save className="size-4" /> Save changes</button>
            </div>
          </div>
          <ol className="mt-5 space-y-3">
            {data.segments.map((s) => (
              <li key={s.idx} className="grid gap-2 sm:grid-cols-[72px_1fr]">
                <span className="pt-2 font-mono text-xs text-muted-foreground">{mmss(s.start)}</span>
                <label className="sr-only" htmlFor={`seg-${s.idx}`}>Segment {s.idx + 1}</label>
                <textarea id={`seg-${s.idx}`} rows={2} disabled={!!busy}
                  value={edits[s.idx] ?? s.edited ?? s.original}
                  onChange={(e) => setEdits((x) => ({ ...x, [s.idx]: e.target.value }))}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm" />
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.segments.length > 0 && (
        <section className="mt-6 rounded-3xl border bg-card p-6 shadow-card">
          <h2 className="font-display text-2xl">Translations</h2>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Languages</legend>
            <div className="mt-2 flex gap-2">
              {TARGET_LANGUAGES.filter((l) => TESTED_LANGUAGE_CODES.includes(l.code)).map((l) => (
                <button key={l.code} type="button" disabled={!!busy} aria-pressed={selected.includes(l.code)} onClick={() => toggleTarget(l.code)}
                  className={`rounded-full border px-4 py-2 text-sm ${selected.includes(l.code) ? "border-foreground bg-foreground text-background" : "bg-background"}`}>{l.name}</button>
              ))}
            </div>
          </fieldset>
          <button onClick={translateAll} disabled={!!busy || selected.length === 0 || r.transcriptStatus !== "ready"}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy === "Translating…" ? <Loader2 className="size-4 animate-spin" /> : null} Translate and generate audio
          </button>
          {Object.entries(progress).map(([lang, p]) => <p key={lang} className="mt-2 text-xs text-muted-foreground">{langName(lang)}: {p} segments</p>)}
          <p className="mt-2 text-xs text-muted-foreground">Translated speech can run longer or shorter than the original. Listeners hear the pieces in order.</p>

          {translatedLangs.length > 0 && (
            <ul className="mt-6 divide-y">
              {translatedLangs.map((lang) => (
                <li key={lang} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium">{langName(lang)}</p>
                    <p className="text-xs text-muted-foreground">{data.pieces.filter((p) => p.language === lang && p.url).length} audio pieces</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to="/r/$code" params={{ code: r.publicCode }} className="rounded-full border px-4 py-2 text-sm">Listener page</Link>
                    <button onClick={() => downloadAudio(lang)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm disabled:opacity-50"><Download className="size-4" /> Audio (.wav)</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {busy && <p className="mt-6 text-sm text-muted-foreground">{busy}</p>}
    </AppShell>
  );
}
