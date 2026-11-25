import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FileAudio, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TARGET_LANGUAGES, TESTED_LANGUAGE_CODES } from "@/lib/languages";
import { createSermon, startTranscription, MAX_SOURCE_BYTES } from "@/lib/sermons.functions";

export const Route = createFileRoute("/_authenticated/recordings/")({
  head: () => ({ meta: [{ title: "Recorded sermons — Logosphere" }, { name: "description", content: "Upload a recorded sermon, check its transcript, and translate it." }] }),
  component: RecordingsPage,
});

const BUCKET = "sermon-audio";

function RecordingsPage() {
  const { data: ctx } = useChurchContext();
  const churchId = ctx?.church?.id ?? null;
  const navigate = useNavigate();
  const create = useServerFn(createSermon);
  const transcribe = useServerFn(startTranscription);

  const [title, setTitle] = useState("");
  const [preacher, setPreacher] = useState("");
  const [sermonDate, setSermonDate] = useState(new Date().toISOString().slice(0, 10));
  const [targets, setTargets] = useState<string[]>(["fr"]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const { data: recent = [] } = useQuery({
    queryKey: ["sermons-recent", churchId],
    enabled: !!churchId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("recordings")
        .select("id, title, preacher, sermon_date, transcript_status, status, created_at")
        .eq("church_id", churchId!).is("archived_at", null).order("created_at", { ascending: false }).limit(8);
      return (data ?? []) as { id: string; title: string; preacher: string | null; sermon_date: string | null; transcript_status: string; status: string; created_at: string }[];
    },
  });

  async function upload() {
    if (!churchId || !file) return;
    if (file.size > MAX_SOURCE_BYTES) { toast.error("Audio files can be up to 50 MB"); return; }
    setBusy(true);
    try {
      setStep("Preparing upload…");
      const made = await create({ data: {
        churchId, title: title.trim(), preacher: preacher.trim() || undefined, sermonDate,
        targets: targets as ("fr" | "es")[], fileName: file.name, sizeBytes: file.size, mimeType: file.type || "audio/mpeg",
      } });
      setStep("Uploading audio…");
      const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(made.path, made.token, file, { contentType: file.type || "audio/mpeg" });
      if (error) throw new Error("The upload failed. Check your connection and try again.");
      setStep("Transcribing…");
      await transcribe({ data: { recordingId: made.id } });
      toast.success("Transcript ready. Check and correct it before translating.");
      navigate({ to: "/recordings/$id", params: { id: made.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false); setStep(null);
    }
  }

  const canSubmit = !busy && !!file && title.trim().length > 0 && targets.length > 0;

  return (
    <AppShell active="Recorded Sermons">
      <h1 className="font-display text-4xl">Recorded sermons</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Upload an audio recording. We transcribe it, you check the text, then we translate it into French or Spanish.</p>

      {!churchId ? (
        <p className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <form onSubmit={(e) => { e.preventDefault(); void upload(); }} className="space-y-5 rounded-3xl border bg-card p-7 shadow-card">
            <label className="block">
              <span className="text-sm font-medium">Sermon title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} maxLength={200} required className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm" placeholder="Sunday sermon, 16 November" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Preacher</span>
                <input value={preacher} onChange={(e) => setPreacher(e.target.value)} disabled={busy} maxLength={120} className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Date preached</span>
                <input type="date" value={sermonDate} onChange={(e) => setSermonDate(e.target.value)} disabled={busy} className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm" />
              </label>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Translate into</legend>
              <div className="mt-2 flex gap-2">
                {TARGET_LANGUAGES.filter((l) => TESTED_LANGUAGE_CODES.includes(l.code)).map((l) => (
                  <button key={l.code} type="button" disabled={busy} aria-pressed={targets.includes(l.code)}
                    onClick={() => setTargets((t) => t.includes(l.code) ? t.filter((c) => c !== l.code) : [...t, l.code])}
                    className={`rounded-full border px-4 py-2 text-sm ${targets.includes(l.code) ? "border-foreground bg-foreground text-background" : "bg-background"}`}>{l.name}</button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-medium">Audio file (MP3, WAV, M4A, OGG, FLAC or WebM, up to 50 MB)</span>
              <input type="file" accept="audio/*" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" />
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FileAudio className="size-4" />} {busy ? "Working…" : "Upload and transcribe"}
              </button>
              {step && <span className="text-sm text-muted-foreground">{step}</span>}
            </div>
            {busy && <p className="text-xs text-muted-foreground">Keep this page open until the transcript is ready.</p>}
          </form>

          <aside className="rounded-3xl border bg-card p-6 shadow-card">
            <h2 className="font-display text-xl">Recent sermons</h2>
            {recent.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No sermons yet. Upload your first one.</p> : (
              <ul className="mt-3 divide-y">
                {recent.map((r) => (
                  <li key={r.id} className="py-3">
                    <Link to="/recordings/$id" params={{ id: r.id }} className="font-medium underline-offset-4 hover:underline">{r.title}</Link>
                    <p className="text-xs text-muted-foreground">{r.preacher ?? "Preacher not set"} · {r.transcript_status}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/library" className="mt-4 inline-block text-sm underline">Open the sermon library</Link>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
