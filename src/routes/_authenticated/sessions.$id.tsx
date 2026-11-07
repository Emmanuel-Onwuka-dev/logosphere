import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ArrowLeft, Copy, Pause, Play, Square, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Broadcaster } from "@/components/live/Broadcaster";
import { Switch } from "@/components/ui/switch";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES, STATUS_LABEL } from "@/lib/languages";
import { STATUS_TEXT, publicLink, isActiveListener, sessionSeconds, fmtDuration, setStatus, type Session } from "@/lib/sessions";

export const Route = createFileRoute("/_authenticated/sessions/$id")({
  head: () => ({
    meta: [
      { title: "Session control — Logosphere" },
      { name: "description", content: "Start, pause and stop live interpretation, share the QR code and watch listeners." },
      { property: "og:title", content: "Session control — Logosphere" },
      { property: "og:description", content: "Run a live interpretation session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [, tick] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => {
      const [s, l] = await Promise.all([
        supabase.from("sessions").select("*").eq("id", id).maybeSingle(),
        supabase.from("listener_connections").select("language, last_seen_at, left_at").eq("session_id", id),
      ]);
      if (s.error) throw s.error;
      return { session: s.data, listeners: l.data ?? [] };
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`session-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["session", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "listener_connections", filter: `session_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["session", id] }))
      .subscribe();
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [id, qc]);

  if (isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  const s = data?.session;
  if (!s) return <Shell><p>Session not found, or you don't have access.</p></Shell>;

  const active = data.listeners.filter(isActiveListener);
  const link = publicLink(s.public_code);
  const ended = s.status === "ended";

  async function change(status: Session["status"]) {
    try { await setStatus(s!, status); qc.invalidateQueries({ queryKey: ["session", id] }); }
    catch (e: any) { toast.error(e.message); }
  }
  async function toggleLang(code: string, on: boolean) {
    const next = on ? [...s!.target_languages, code] : s!.target_languages.filter((c) => c !== code);
    const { error } = await supabase.from("sessions").update({ target_languages: next }).eq("id", s!.id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: ["session", id] });
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            From {SOURCE_LANGUAGES.find((l) => l.code === s.source_language)?.name} · {fmtDuration(sessionSeconds(s))}
          </p>
          <h1 className="mt-2 font-display text-4xl">{s.title}</h1>
          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${s.status === "live" ? "bg-live text-primary-foreground" : "bg-secondary"}`}>
            {s.status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />}{STATUS_TEXT[s.status]}
          </span>
        </div>
        {!ended && (
          <div className="flex flex-wrap gap-2">
            {s.status === "live"
              ? <Btn onClick={() => change("paused")}><Pause className="size-4" /> Pause</Btn>
              : <Btn primary onClick={() => change("live")}><Play className="size-4" /> {s.status === "paused" ? "Resume" : "Start interpretation"}</Btn>}
            {s.status !== "draft" && <Btn onClick={() => { if (confirm("End this session for everyone?")) change("ended"); }}><Square className="size-4" /> Stop</Btn>}
          </div>
        )}
      </div>

      {!ended && <Broadcaster sessionId={s.id} live={s.status === "live"} />}

      <div className="mt-10 grid gap-6 md:grid-cols-[1fr_280px]">
        <section className="rounded-3xl border bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Language channels</h2>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Users className="size-4" /> {active.length} listening</span>
          </div>
          <ul className="mt-5 divide-y">
            {TARGET_LANGUAGES.filter((l) => l.code !== s.source_language).map((l) => {
              const on = s.target_languages.includes(l.code);
              const n = active.filter((a) => a.language === l.code).length;
              return (
                <li key={l.code} className="flex items-center gap-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.name} <span className="text-muted-foreground">· {l.native}</span></p>
                    <p className="text-xs text-muted-foreground">Engine: none connected · {STATUS_LABEL[l.status]}</p>
                  </div>
                  <span className="w-20 text-right text-sm tabular-nums">{n} {n === 1 ? "listener" : "listeners"}</span>
                  <Switch checked={on} disabled={ended} onCheckedChange={(v) => toggleLang(l.code, v)} aria-label={`Enable ${l.name}`} />
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">No interpretation engine is connected yet, so language channels won't carry interpreted audio yet. The preacher's original voice is already sent live.</p>
        </section>

        <aside className="rounded-3xl border bg-card p-6 text-center shadow-card">
          <h2 className="font-display text-xl">Congregation link</h2>
          <div className="mx-auto mt-4 w-fit rounded-2xl bg-background p-3"><QRCodeSVG value={link} size={190} /></div>
          <p className="mt-4 break-all font-mono text-xs text-muted-foreground">{link}</p>
          <button onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }} className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm"><Copy className="size-3.5" /> Copy link</button>
        </aside>
      </div>
    </Shell>
  );
}

function Btn({ primary, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button {...p} className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium ${primary ? "bg-primary text-primary-foreground" : "border"}`} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-5 py-10">
        <Link to="/dashboard" className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> Dashboard</Link>
        {children}
      </main>
    </div>
  );
}
