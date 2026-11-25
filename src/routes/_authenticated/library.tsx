import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TARGET_LANGUAGES } from "@/lib/languages";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Sermon library — Logosphere" }] }),
  component: LibraryPage,
});

type Row = { id: string; title: string; status: "processing" | "ready" | "failed"; target_languages: string[]; duration_seconds: number; public_code: string; created_at: string };

/** The church's saved recorded sermons, with search and status filtering. */
function LibraryPage() {
  const { data: ctx } = useChurchContext();
  const churchId = ctx?.church?.id ?? null;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Row["status"]>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["library", churchId],
    enabled: !!churchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("recordings")
        .select("id, title, status, target_languages, duration_seconds, public_code, created_at")
        .eq("church_id", churchId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const shown = useMemo(() => rows.filter((r) =>
    (status === "all" || r.status === status) && r.title.toLowerCase().includes(query.trim().toLowerCase()),
  ), [rows, query, status]);

  return (
    <AppShell active="Sermon Library">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Sermon library</h1>
          <p className="mt-2 text-muted-foreground">Every recorded sermon your church has translated.</p>
        </div>
        <Link to="/recordings" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">Upload a sermon</Link>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" aria-label="Search sermons" className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm sm:max-w-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status" className="rounded-xl border bg-background px-3 py-2.5 text-sm">
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <section className="mt-6 rounded-3xl border bg-card shadow-card">
        {!churchId ? <p className="p-6 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
          : isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No recorded sermons yet. <Link to="/recordings" className="underline">Upload your first sermon.</Link></p>
          : shown.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No sermons match your search.</p>
          : (
            <ul className="divide-y">
              {shown.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()} · {r.target_languages.map((c) => TARGET_LANGUAGES.find((l) => l.code === c)?.name ?? c).join(", ")} · {r.status}</p>
                  </div>
                  {r.status === "ready" && <a href={`/r/${r.public_code}`} target="_blank" rel="noreferrer" className="rounded-full border px-4 py-2 text-sm">Listener link</a>}
                </li>
              ))}
            </ul>
          )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">Editing, deleting and archiving recordings are not available yet.</p>
    </AppShell>
  );
}
