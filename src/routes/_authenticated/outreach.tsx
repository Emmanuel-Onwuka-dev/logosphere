import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TARGET_LANGUAGES } from "@/lib/languages";

export const Route = createFileRoute("/_authenticated/outreach")({
  head: () => ({ meta: [{ title: "Evangelism & outreach — Logosphere" }] }),
  component: OutreachPage,
});

/**
 * Conversation history for the church's outreach sessions: listener replies, translated to English.
 * Listener-to-preacher replies are live today; the preacher-to-listener voice workspace comes next.
 */
function OutreachPage() {
  const { data: ctx } = useChurchContext();
  const churchId = ctx?.church?.id ?? null;

  const { data: replies = [], isLoading } = useQuery({
    queryKey: ["outreach-replies", churchId],
    enabled: !!churchId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("session_replies")
        .select("id, language, original, english, created_at, session:sessions(title, church_id, public_code)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => r.session?.church_id === churchId);
    },
  });

  return (
    <AppShell active="Evangelism & Outreach">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Evangelism & outreach</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Conversations with people who speak other languages. Their replies appear here in English, and each one is linked to the service it came from.</p>
        </div>
        <Link to="/dashboard" className="rounded-full border px-5 py-2.5 text-sm font-medium">Start a service</Link>
      </div>

      <section className="mt-10 rounded-3xl border bg-card p-6 shadow-card">
        <h2 className="font-display text-2xl">Conversation history</h2>
        {!churchId ? <p className="mt-4 text-sm text-muted-foreground">Register a church on the dashboard to see outreach conversations.</p>
          : isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          : replies.length === 0 ? (
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p>No replies yet. When a listener answers during a live service, their reply appears here.</p>
              <Link to="/dashboard" className="inline-block text-foreground underline">Start a live service</Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y">
              {replies.map((r) => (
                <li key={r.id} className="py-4">
                  <p className="text-xs text-muted-foreground">{TARGET_LANGUAGES.find((l) => l.code === r.language)?.name ?? r.language} · {new Date(r.created_at).toLocaleString()} · {r.session?.title}</p>
                  <p className="mt-1 font-display text-lg">{r.english}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Original: {r.original}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </AppShell>
  );
}
