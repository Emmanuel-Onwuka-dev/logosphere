import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { setArchived, deleteSermon } from "@/lib/sermons.functions";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "Sermon library — Logosphere" }] }),
  component: LibraryPage,
});

type Row = { id: string; title: string; preacher: string | null; sermon_date: string | null; status: string; transcript_status: string; target_languages: string[]; public_code: string; created_at: string; archived_at: string | null };

/** Saved sermons with search, filters, archive and delete. */
function LibraryPage() {
  const { data: ctx } = useChurchContext();
  const churchId = ctx?.church?.id ?? null;
  const qc = useQueryClient();
  const archive = useServerFn(setArchived);
  const remove = useServerFn(deleteSermon);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "archived" | "ready" | "failed">("active");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["library", churchId],
    enabled: !!churchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("recordings")
        .select("id, title, preacher, sermon_date, status, transcript_status, target_languages, public_code, created_at, archived_at")
        .eq("church_id", churchId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const shown = useMemo(() => rows.filter((r) => {
    const matchesFilter = filter === "active" ? !r.archived_at
      : filter === "archived" ? !!r.archived_at
      : filter === "ready" ? r.transcript_status === "ready" && !r.archived_at
      : r.transcript_status === "failed" && !r.archived_at;
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || r.title.toLowerCase().includes(q) || (r.preacher ?? "").toLowerCase().includes(q);
    return matchesFilter && matchesQuery;
  }), [rows, query, filter]);

  async function toggleArchive(r: Row) {
    setBusyId(r.id);
    try { await archive({ data: { recordingId: r.id, archived: !r.archived_at } }); toast.success(r.archived_at ? "Restored" : "Archived"); await qc.invalidateQueries({ queryKey: ["library", churchId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update"); }
    finally { setBusyId(null); }
  }

  async function deleteRow(r: Row) {
    if (!confirm(`Delete "${r.title}", its audio and its transcript? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await remove({ data: { recordingId: r.id } }); toast.success("Sermon deleted"); await qc.invalidateQueries({ queryKey: ["library", churchId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
    finally { setBusyId(null); }
  }

  return (
    <AppShell active="Sermon Library">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Sermon library</h1>
          <p className="mt-2 text-muted-foreground">Every recorded sermon your church has uploaded.</p>
        </div>
        <Link to="/recordings" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">Upload a sermon</Link>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or preacher" aria-label="Search sermons" className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm sm:max-w-sm" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter sermons" className="rounded-xl border bg-background px-3 py-2.5 text-sm">
          <option value="active">Active</option>
          <option value="ready">Transcript ready</option>
          <option value="failed">Transcript failed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <section className="mt-6 rounded-3xl border bg-card shadow-card">
        {!churchId ? <p className="p-6 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
          : isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No recorded sermons yet. <Link to="/recordings" className="underline">Upload your first sermon.</Link></p>
          : shown.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No sermons match this filter.</p>
          : (
            <ul className="divide-y">
              {shown.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="min-w-0">
                    <Link to="/recordings/$id" params={{ id: r.id }} className="truncate font-medium underline-offset-4 hover:underline">{r.title}</Link>
                    <p className="text-xs text-muted-foreground">
                      {[r.preacher, r.sermon_date ?? new Date(r.created_at).toLocaleDateString()].filter(Boolean).join(" · ")} · transcript {r.transcript_status}
                      {r.target_languages.length > 0 && ` · ${r.target_languages.map((c) => TARGET_LANGUAGES.find((l) => l.code === c)?.name ?? c).join(", ")}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status === "ready" && <Link to="/r/$code" params={{ code: r.public_code }} className="rounded-full border px-4 py-2 text-sm">Listener page</Link>}
                    <button onClick={() => toggleArchive(r)} disabled={busyId === r.id} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50">{r.archived_at ? "Restore" : "Archive"}</button>
                    <button onClick={() => deleteRow(r)} disabled={busyId === r.id} className="rounded-full border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-50">Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </AppShell>
  );
}
