import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PCM_SAMPLE_RATE, LONG_TEST_LIMIT_SECONDS, encodeWav, toBase64 } from "@/lib/deepgram";
import { findCuts } from "@/lib/interpretation";
import { TARGET_LANGUAGES, TESTED_LANGUAGE_CODES } from "@/lib/languages";
import { createRecording, finishRecording, listRecordings, processRecordingPiece } from "@/lib/recordings.functions";

export const Route = createFileRoute("/_authenticated/recordings")({
  head: () => ({ meta: [{ title: "Recorded sermons — Logosphere" }, { name: "description", content: "Translate a recorded sermon into French or Spanish and share it with listeners." }] }),
  component: RecordingsPage,
});

const CONCURRENCY = 3;

/** Runs `task` over `items` with at most `limit` in flight, keeping results in input order. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]!; await task(item); }
  }));
}

function RecordingsPage() {
  const qc = useQueryClient();
  const create = useServerFn(createRecording);
  const finish = useServerFn(finishRecording);
  const processPiece = useServerFn(processRecordingPiece);
  const list = useServerFn(listRecordings);

  const { data: church } = useQuery({
    queryKey: ["my-church"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("church_id").eq("id", user.id).maybeSingle();
      return (data?.church_id as string | null) ?? null;
    },
  });
  const churchId = church ?? null;

  const { data: recordings = [] } = useQuery({
    queryKey: ["recordings", churchId],
    enabled: !!churchId,
    queryFn: () => list({ data: { churchId: churchId! } }),
  });

  const [title, setTitle] = useState("");
  const [targets, setTargets] = useState<string[]>(TESTED_LANGUAGE_CODES.slice());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<{ publicCode: string; title: string } | null>(null);
  const [failures, setFailures] = useState(0);

  async function translate() {
    if (!churchId || !file || !title.trim() || targets.length === 0) return;
    setBusy(true); setDone(null); setFailures(0);
    try {
      setProgress("Reading the recording…");
      const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      let decoded: AudioBuffer;
      try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); }
      catch { throw new Error("Could not read this file. Use a WAV or MP3 recording."); }
      finally { void ctx.close(); }
      const samples = decoded.getChannelData(0);
      const seconds = samples.length / PCM_SAMPLE_RATE;
      if (seconds > LONG_TEST_LIMIT_SECONDS) throw new Error(`Recordings can be up to ${LONG_TEST_LIMIT_SECONDS / 60} minutes long.`);

      const cuts = findCuts(samples, PCM_SAMPLE_RATE).filter((c) => c.endSeconds > c.startSeconds);
      const { id, publicCode } = await create({ data: { churchId, title: title.trim(), targets: targets as ("fr" | "es")[], durationSeconds: seconds } });

      let failed = 0;
      for (const lang of targets as ("fr" | "es")[]) {
        const name = TARGET_LANGUAGES.find((l) => l.code === lang)?.name ?? lang;
        let finished = 0;
        await pool(cuts, CONCURRENCY, async (cut) => {
          const pcm = samples.slice(Math.round(cut.startSeconds * PCM_SAMPLE_RATE), Math.round(cut.endSeconds * PCM_SAMPLE_RATE));
          const audioBase64 = toBase64(encodeWav(pcm));
          const send = () => processPiece({ data: { recordingId: id, language: lang, index: cut.index, startSeconds: cut.startSeconds, endSeconds: cut.endSeconds, audioBase64 } });
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try { ok = (await send()).ok; } catch { ok = false; }
          }
          if (!ok) failed += 1;
          finished += 1;
          setProgress(`${name}: ${finished} of ${cuts.length} pieces`);
        });
      }

      setProgress("Finishing…");
      await finish({ data: { recordingId: id } });
      setFailures(failed);
      setDone({ publicCode, title: title.trim() });
      setProgress(null);
      toast.success("Recording translated");
      void qc.invalidateQueries({ queryKey: ["recordings", churchId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const link = done ? `${window.location.origin}/r/${done.publicCode}` : "";

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> Dashboard</Link>
      <h1 className="mt-4 font-display text-4xl">Recorded sermons</h1>
      <p className="mt-2 text-muted-foreground">Upload a sermon you have already recorded. We translate it into French or Spanish and give you a link for listeners.</p>

      {!churchId ? (
        <p className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">Create or join a church first, then come back to translate recordings.</p>
      ) : (
        <div className="mt-8 space-y-5 rounded-3xl border bg-card p-6 shadow-card">
          <label className="block">
            <span className="text-sm font-medium">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} maxLength={200} className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm" placeholder="Sunday sermon, 16 November" />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Translate into</legend>
            <div className="mt-2 flex gap-2">
              {TARGET_LANGUAGES.filter((l) => TESTED_LANGUAGE_CODES.includes(l.code)).map((l) => (
                <button key={l.code} type="button" disabled={busy} onClick={() => setTargets((t) => t.includes(l.code) ? t.filter((c) => c !== l.code) : [...t, l.code])}
                  className={`rounded-full border px-4 py-2 text-sm ${targets.includes(l.code) ? "border-foreground bg-foreground text-background" : "bg-background"}`}>{l.name}</button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-sm font-medium">Recording (WAV or MP3, up to {LONG_TEST_LIMIT_SECONDS / 60} minutes)</span>
            <input type="file" accept="audio/wav,audio/mpeg,audio/mp3,audio/x-wav" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={translate} disabled={busy || !file || !title.trim() || targets.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {busy ? "Translating…" : "Translate recording"}
            </button>
            {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
          </div>
          {busy && <p className="text-xs text-muted-foreground">Keep this page open until the translation finishes.</p>}
          {done && (
            <div className="rounded-2xl border bg-background p-5">
              <p className="font-medium">{done.title} is ready.</p>
              {failures > 0 && <p className="mt-1 text-sm text-destructive">{failures} piece(s) could not be translated and will be silent for listeners.</p>}
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <div className="rounded-2xl bg-card p-3"><QRCodeSVG value={link} size={150} /></div>
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs text-muted-foreground">{link}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {churchId && recordings.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Your recordings</h2>
          <ul className="mt-4 divide-y rounded-3xl border bg-card">
            {recordings.map((r: any) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm">
                <span className="font-medium">{r.title}</span>
                <span className="text-muted-foreground">{r.target_languages.join(", ")} · {r.status}</span>
                {r.status === "ready" && <a className="underline" href={`/r/${r.public_code}`} target="_blank" rel="noreferrer">Listener link</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
