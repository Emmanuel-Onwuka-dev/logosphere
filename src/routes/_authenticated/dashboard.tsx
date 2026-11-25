import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Headphones, Mic, Radio, Users, MessageCircle, FileAudio, Languages } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChurchSessions } from "@/components/dashboard/ChurchSessions";
import { AppShell } from "@/components/app/AppShell";
import { dashboardStats } from "@/lib/dashboardStats";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Logosphere" },
      { name: "description", content: "Manage live interpretation, recorded sermons and outreach for your church on Logosphere." },
      { property: "og:title", content: "Dashboard — Logosphere" },
      { property: "og:description", content: "Your Logosphere ministry workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Platform admin", church_admin: "Church admin", media_operator: "Media operator", listener: "Listener",
};

function Dashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me", user.id],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("display_name, church_id").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role, church_id").eq("user_id", user.id),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      const churchId = p.data?.church_id;
      const church = churchId ? (await supabase.from("churches").select("*").eq("id", churchId).maybeSingle()).data : null;
      return { profile: p.data, roles: r.data ?? [], church };
    },
  });

  const churchId = data?.church?.id ?? null;

  const { data: overview } = useQuery({
    queryKey: ["dashboard-overview", churchId],
    enabled: !!churchId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [sessions, recordings, replies] = await Promise.all([
        supabase.from("sessions").select("id, status, started_at, ended_at, title, created_at").eq("church_id", churchId!).order("created_at", { ascending: false }),
        (supabase as any).from("recordings").select("id, title, status, created_at, target_languages").eq("church_id", churchId!).order("created_at", { ascending: false }),
        (supabase as any).from("session_replies").select("id, language, english, created_at, session:sessions(title, church_id)").order("created_at", { ascending: false }).limit(200),
      ]);
      const sessionRows = sessions.data ?? [];
      const ids = sessionRows.map((s) => s.id);
      const listeners = ids.length
        ? await supabase.from("listener_connections").select("session_id, left_at, last_seen_at").in("session_id", ids)
        : { data: [] as { session_id: string; left_at: string | null; last_seen_at: string }[] };
      const churchReplies = (replies.data ?? []).filter((r: any) => r.session?.church_id === churchId);
      const recordingRows = recordings.data ?? [];
      const stats = dashboardStats({
        sessions: sessionRows as any,
        recordings: recordingRows as any,
        listeners: (listeners.data ?? []) as any,
        outreachReplies: churchReplies.length,
        enabledLanguages: (data?.church as any)?.enabled_languages ?? [],
      });
      return { stats, sessions: sessionRows.slice(0, 3), recordings: recordingRows.slice(0, 3), replies: churchReplies.slice(0, 3) };
    },
  });

  const roles = [...new Set((data?.roles ?? []).map((r) => r.role))];
  const canOperate = roles.some((r) => ["church_admin", "media_operator", "platform_admin"].includes(r));
  const church = data?.church as any;

  return (
    <AppShell active="Dashboard">
      {isLoading || !data ? <p className="text-muted-foreground">Loading…</p> : (
        <>
          <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Signed in as {user.email}</p>
              <h1 className="mt-2 font-display text-4xl">Welcome, {data.profile?.display_name ?? "friend"}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {roles.map((r) => <span key={r} className="rounded-full bg-secondary px-3 py-1 text-xs">{ROLE_LABEL[r] ?? r}</span>)}
                {church && <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Building2 className="size-4" /> {church.name}{church.city ? ` · ${church.city}` : ""}</span>}
              </div>
            </div>
            {church && canOperate && (
              <div className="flex flex-wrap gap-2">
                <a href="#live" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"><Radio className="size-4" /> New live session</a>
                <Link to="/recordings" className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium"><FileAudio className="size-4" /> Upload sermon</Link>
              </div>
            )}
          </section>

          {!church ? (
            <div className="mt-10"><RegisterChurch onDone={() => qc.invalidateQueries({ queryKey: ["me"] })} /></div>
          ) : (
            <>
              <section aria-label="Overview" className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
                {overview ? [
                  ["Live sessions", overview.stats.totalSessions, Radio],
                  ["Active now", overview.stats.activeSessions, Mic],
                  ["Listeners connected", overview.stats.connectedListeners, Headphones],
                  ["Recorded sermons", overview.stats.totalRecordings, FileAudio],
                  ["Translated sermons", overview.stats.translatedRecordings, Languages],
                  ["Interpretation hours", overview.stats.interpretationHours, Users],
                  ["Outreach replies", overview.stats.outreachReplies, MessageCircle],
                  ["Languages enabled", overview.stats.languagesEnabled, Languages],
                ].map(([label, value, Icon]: any) => (
                  <div key={label} className="rounded-2xl border bg-card p-4">
                    <Icon className="size-4 text-muted-foreground" />
                    <p className="mt-3 font-display text-3xl tabular-nums">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                )) : <p className="col-span-full text-sm text-muted-foreground">Loading figures…</p>}
              </section>

              <section aria-label="Products" className="mt-10 grid gap-4 md:grid-cols-3">
                <ProductCard title="Live interpretation" icon={Radio} body="Start a live sermon, manage language channels and invite congregants." action="Open live sessions" to="#live" />
                <ProductCard title="Recorded sermons" icon={FileAudio} body="Upload, transcribe, translate, generate audio and manage recorded messages." action="Open recorded sermons" to="/recordings" />
                <ProductCard title="Evangelism & outreach" icon={MessageCircle} body="Start multilingual conversations and facilitate two-way interpretation." action="Open outreach" to="/outreach" />
              </section>

              <section id="live" className="mt-12 scroll-mt-24">
                <ChurchSessions churchId={church.id} canOperate={canOperate} userId={user.id} enabledLanguages={church.enabled_languages ?? undefined} />
              </section>

              <div className="mt-12 grid gap-6 md:grid-cols-3">
                <RecentList title="Recent recordings" empty="No recorded sermons yet." cta={{ to: "/recordings", label: "Upload a sermon" }}>
                  {overview?.recordings.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-muted-foreground">{r.status}</span></li>
                  ))}
                </RecentList>
                <RecentList title="Recent outreach" empty="No outreach conversations yet." cta={{ to: "/outreach", label: "Open outreach" }}>
                  {overview?.replies.map((r: any) => (
                    <li key={r.id} className="py-2 text-sm"><p className="truncate">{r.english}</p><p className="text-xs text-muted-foreground">{r.session?.title}</p></li>
                  ))}
                </RecentList>
                <RecentList title="Recent live sessions" empty="No live sessions yet. Create one below." cta={{ to: "#live", label: "Create a session" }}>
                  {overview?.sessions.map((s: any) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{s.title}</span><span className="shrink-0 text-xs text-muted-foreground">{s.status}</span></li>
                  ))}
                </RecentList>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function ProductCard({ title, icon: Icon, body, action, to }: { title: string; icon: any; body: string; action: string; to: string }) {
  const inner = (
    <>
      <span className="grid size-10 place-items-center rounded-xl bg-secondary"><Icon className="size-5" /></span>
      <p className="mt-4 font-display text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <span className="mt-5 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{action}</span>
    </>
  );
  return to.startsWith("#") ? <a href={to} className="rounded-3xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5">{inner}</a>
    : <Link to={to} className="rounded-3xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5">{inner}</Link>;
}

function RecentList({ title, empty, cta, children }: { title: string; empty: string; cta: { to: string; label: string }; children: React.ReactNode }) {
  const hasItems = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <section className="rounded-3xl border bg-card p-6">
      <h2 className="font-display text-xl">{title}</h2>
      {hasItems ? <ul className="mt-3 divide-y">{children}</ul> : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">{empty}</p>
          {cta.to.startsWith("#") ? <a href={cta.to} className="text-sm underline">{cta.label}</a> : <Link to={cta.to} className="text-sm underline">{cta.label}</Link>}
        </div>
      )}
    </section>
  );
}

function RegisterChurch({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(""); const [city, setCity] = useState(""); const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc("create_church", { _name: name, _city: city, _country: country });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Church registered"); onDone();
  }
  return (
    <form onSubmit={submit} className="max-w-lg space-y-4 rounded-3xl border bg-card p-7 shadow-card">
      <h2 className="font-display text-2xl">Register your church</h2>
      <p className="text-sm text-muted-foreground">You'll become its church admin. Then you can start live sessions, upload sermons and open outreach.</p>
      <div className="space-y-1.5"><Label htmlFor="cn">Church name</Label><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="city">City</Label><Input id="city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ctry">Country</Label><Input id="ctry" value={country} onChange={(e) => setCountry(e.target.value)} /></div>
      </div>
      <button disabled={busy} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Register church"}</button>
    </form>
  );
}
