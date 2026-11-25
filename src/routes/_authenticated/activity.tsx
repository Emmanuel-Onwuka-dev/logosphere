import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { dashboardStats, sessionSeconds } from "@/lib/dashboardStats";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Usage & activity — Logosphere" }] }),
  component: ActivityPage,
});

function fmtHours(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Usage and history for the church, from the same rows the dashboard uses. */
function ActivityPage() {
  const { data: ctx } = useChurchContext();
  const churchId = ctx?.church?.id ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["activity", churchId],
    enabled: !!churchId,
    queryFn: async () => {
      const [sessions, recordings, replies] = await Promise.all([
        supabase.from("sessions").select("id, title, status, started_at, ended_at, created_at").eq("church_id", churchId!).order("created_at", { ascending: false }),
        (supabase as any).from("recordings").select("id, title, status, duration_seconds, created_at").eq("church_id", churchId!).order("created_at", { ascending: false }),
        (supabase as any).from("session_replies").select("id, session:sessions(church_id)").limit(1000),
      ]);
      const sessionRows = sessions.data ?? [];
      const recordingRows = recordings.data ?? [];
      const replyCount = ((replies.data ?? []) as any[]).filter((r) => r.session?.church_id === churchId).length;
      const stats = dashboardStats({
        sessions: sessionRows as any, recordings: recordingRows as any, listeners: [], outreachReplies: replyCount,
        enabledLanguages: ctx?.church?.enabled_languages ?? [],
      });
      return { sessions: sessionRows, recordings: recordingRows, stats };
    },
  });

  return (
    <AppShell active="Usage & Activity">
      <h1 className="font-display text-4xl">Usage & activity</h1>
      <p className="mt-2 text-muted-foreground">What your church has used, from its own sessions and recordings.</p>
      {!churchId ? <p className="mt-8 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
        : isLoading || !data ? <p className="mt-8 text-muted-foreground">Loading…</p> : (
          <>
            <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Live sessions", data.stats.totalSessions],
                ["Interpretation time", fmtHours(data.sessions.reduce((s, x) => s + sessionSeconds(x as any, Date.now()), 0))],
                ["Recorded sermons", data.stats.totalRecordings],
                ["Outreach replies", data.stats.outreachReplies],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-2xl border bg-card p-4">
                  <p className="font-display text-3xl tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </section>

            <section className="mt-10 rounded-3xl border bg-card p-6 shadow-card">
              <h2 className="font-display text-2xl">Live sessions</h2>
              {data.sessions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No live sessions yet.</p> : (
                <table className="mt-4 w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-2">Title</th><th>Status</th><th>Started</th><th className="text-right">Duration</th></tr></thead>
                  <tbody className="divide-y">
                    {data.sessions.map((s: any) => (
                      <tr key={s.id}><td className="py-2">{s.title}</td><td>{s.status}</td><td>{s.started_at ? new Date(s.started_at).toLocaleString() : "—"}</td><td className="text-right tabular-nums">{fmtHours(sessionSeconds(s, Date.now()))}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="mt-6 rounded-3xl border bg-card p-6 shadow-card">
              <h2 className="font-display text-2xl">Recorded sermons</h2>
              {data.recordings.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No recorded sermons yet.</p> : (
                <table className="mt-4 w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-2">Title</th><th>Status</th><th>Uploaded</th><th className="text-right">Length</th></tr></thead>
                  <tbody className="divide-y">
                    {data.recordings.map((r: any) => (
                      <tr key={r.id}><td className="py-2">{r.title}</td><td>{r.status}</td><td>{new Date(r.created_at).toLocaleString()}</td><td className="text-right tabular-nums">{fmtHours(Number(r.duration_seconds ?? 0))}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
    </AppShell>
  );
}
