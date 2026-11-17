import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Mic, Square, Upload, Play, ShieldAlert, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from "@/lib/languages";
import { runPlayground } from "@/lib/engines.functions";

export const Route = createFileRoute("/_authenticated/playground")({
  head: () => ({
    meta: [
      { title: "Model Playground — Logosphere" },
      { name: "description", content: "Test interpretation engines with recorded or uploaded audio, compare latency and output." },
      { property: "og:title", content: "Model Playground — Logosphere" },
      { property: "og:description", content: "Compare AI interpretation engines side by side." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Playground,
});

const db = supabase as any;
const MAX = 10 * 1024 * 1024;
type Result = Awaited<ReturnType<typeof runPlayground>>["results"][number];

function Playground() {
  const { user } = Route.useRouteContext();
  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-platform-admin", user.id],
    queryFn: async () => (await supabase.rpc("has_role", { _user_id: user.id, _role: "platform_admin" })).data ?? false,
  });
  if (isLoading) return null;
  if (!isAdmin) return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center"><div>
      <ShieldAlert className="mx-auto size-8" /><h1 className="mt-3 font-display text-2xl">Platform admins only</h1>
      <Link to="/dashboard" className="mt-4 inline-block text-sm underline">Back to dashboard</Link></div></div>
  );
  return <Lab />;
}

function Lab() {
  const qc = useQueryClient();
  const run = useServerFn(runPlayground);
  const { data: endpoints = [] } = useQuery({
    queryKey: ["pg-endpoints"],
    queryFn: async () => (await db.from("inference_endpoints").select("id, endpoint_name, endpoint_url, status, ai_engines(engine_name, model_id)").order("created_at")).data ?? [],
  });
  const { data: history = [] } = useQuery({
    queryKey: ["pg-runs"],
    queryFn: async () => (await db.from("playground_runs").select("*, inference_endpoints(endpoint_name)").order("created_at", { ascending: false }).limit(30)).data ?? [],
  });
  const [audio, setAudio] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const [src, setSrc] = useState("en");
  const [tgt, setTgt] = useState(TARGET_LANGUAGES[0]!.code);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  function takeClip(blob: Blob, name: string) {
    if (blob.size > MAX) { toast.error("Audio must be under 10 MB"); return; }
    if (audio) URL.revokeObjectURL(audio.url);
    setAudio({ blob, name, url: URL.createObjectURL(blob) });
  }
  async function toggleMic() {
    if (recording) { rec.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setRecording(false); takeClip(new Blob(chunks, { type: r.mimeType }), `mic-${new Date().toLocaleTimeString()}`); };
      rec.current = r; r.start(); setRecording(true);
    } catch { toast.error("Microphone access was blocked"); }
  }
  async function go() {
    if (!audio || !picked.length) return;
    setBusy(true); setResults([]);
    try {
      const b = new Uint8Array(await audio.blob.arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      const r = await run({ data: { endpointIds: picked, audioBase64: btoa(s), mimeType: audio.blob.type || "audio/wav", inputName: audio.name, sourceLanguage: src, targetLanguage: tgt } });
      setResults(r.results.sort((a, b) => (a.latency_ms ?? 1e9) - (b.latency_ms ?? 1e9)));
      qc.invalidateQueries({ queryKey: ["pg-runs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Test failed"); }
    setBusy(false);
  }
  async function rate(id: string | null, rating: number) {
    if (!id) return;
    const { error } = await db.from("playground_runs").update({ rating }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Rating saved"); qc.invalidateQueries({ queryKey: ["pg-runs"] }); }
  }
  const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
        <Link to="/dashboard" className="text-muted-foreground"><ArrowLeft className="size-4" /></Link>
        <h1 className="font-display text-xl">Model Playground</h1>
        <Link to="/control" className="ml-auto text-sm underline">Control Centre</Link>
      </div></header>
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[380px_1fr]">
        <section className="space-y-5 rounded-3xl border bg-card p-5 shadow-card">
          <div>
            <h2 className="font-display text-lg">1. Audio</h2>
            <div className="mt-3 flex gap-2">
              <button onClick={toggleMic} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm ${recording ? "border-destructive text-destructive" : ""}`}>
                {recording ? <><Square className="size-4" /> Stop</> : <><Mic className="size-4" /> Record</>}
              </button>
              <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm">
                <Upload className="size-4" /> Upload
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) takeClip(f, f.name); e.target.value = ""; }} />
              </label>
            </div>
            {audio && <div className="mt-3"><p className="truncate text-xs text-muted-foreground">{audio.name} · {(audio.blob.size / 1024).toFixed(0)} KB</p><audio controls src={audio.url} className="mt-1 w-full" /></div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="src">From</Label>
              <select id="src" value={src} onChange={(e) => setSrc(e.target.value)} className={sel}>{SOURCE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
            <div className="space-y-1.5"><Label htmlFor="tgt">To</Label>
              <select id="tgt" value={tgt} onChange={(e) => setTgt(e.target.value)} className={sel}>{TARGET_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
          </div>
          <div>
            <h2 className="font-display text-lg">2. Endpoints <span className="text-xs text-muted-foreground">(pick up to 4 to compare)</span></h2>
            {endpoints.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No endpoints yet. Add one in the Control Centre.</p> : (
              <ul className="mt-2 space-y-1.5">{endpoints.map((e: any) => {
                const on = picked.includes(e.id);
                return <li key={e.id}><label className="flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm">
                  <input type="checkbox" checked={on} disabled={!on && picked.length >= 4} onChange={() => setPicked(on ? picked.filter((x) => x !== e.id) : [...picked, e.id])} className="mt-1" />
                  <span className="min-w-0"><span className="block font-medium">{e.endpoint_name}</span><span className="block truncate text-xs text-muted-foreground">{e.ai_engines?.engine_name}{e.ai_engines?.model_id ? ` · ${e.ai_engines.model_id}` : ""} · {e.status}</span></span>
                </label></li>;
              })}</ul>
            )}
          </div>
          <button onClick={go} disabled={busy || !audio || !picked.length} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Play className="size-4" /> {busy ? "Running…" : "Run test"}
          </button>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What the engine receives</summary>
            <p className="mt-2">A POST to the endpoint's API URL with JSON: <code>audio_base64, mime_type, source_language, target_language, model_id</code>. It may reply with audio, or JSON containing <code>audio_base64</code> and/or <code>text</code>.</p>
            <p className="mt-2">Endpoints whose address contains <code>intron.io</code> run a three-step pipeline instead: Intron turns the audio into words, the built-in model translates those words, and Intron speaks them in Hausa, Yoruba or Igbo.</p></details>
        </section>

        <div className="space-y-6">
          <section>
            <h2 className="font-display text-2xl">Results</h2>
            {results.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Run a test to compare engines here, fastest first.</p> : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{results.map((r, i) => (
                <article key={r.endpointId} className="rounded-3xl border bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="font-medium">{r.endpointName}</p><p className="text-xs text-muted-foreground">{r.engineName}</p></div>
                    {r.ok && i === 0 && results.length > 1 && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">Fastest</span>}
                  </div>
                  <p className={`mt-3 font-display text-2xl tabular-nums ${r.ok ? "" : "text-destructive"}`}>{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</p>
                  {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                  {r.audio && <audio controls src={`data:${r.audioMime};base64,${r.audio}`} className="mt-2 w-full" />}
                  {r.transcript && <p className="mt-2 max-h-24 overflow-auto rounded-xl bg-muted/60 p-2 text-xs text-muted-foreground">Heard: {r.transcript}</p>}
                  {r.output_text && <p className="mt-2 max-h-32 overflow-auto rounded-xl bg-muted p-2 text-sm">{r.output_text}</p>}
                  <div className="mt-3 flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => rate(r.runId, n)} aria-label={`Rate ${n}`}><Star className="size-4 text-muted-foreground" /></button>)}</div>
                </article>
              ))}</div>
            )}
          </section>
          <section className="rounded-3xl border bg-card p-5 shadow-card">
            <h2 className="font-display text-lg">Saved test results</h2>
            {history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing saved yet.</p> : (
              <ul className="mt-3 divide-y text-sm">{history.map((h: any) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{h.inference_endpoints?.endpoint_name ?? "Deleted endpoint"} · {h.source_language} → {h.target_language}</span>
                  <span className={h.ok ? "" : "text-destructive"}>{h.ok ? `${h.latency_ms} ms` : h.error}{h.rating ? ` · ${h.rating}★` : ""}</span>
                  <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
                </li>
              ))}</ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
