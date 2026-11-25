import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SOURCE_LANGUAGES, ACTIVE_TARGET_LANGUAGES, TESTED_LANGUAGE_CODES, isComingSoon } from "@/lib/languages";
import { STATUS_TEXT, isActiveListener, sessionSeconds, fmtDuration } from "@/lib/sessions";

export function ChurchSessions({ churchId, canOperate, userId, enabledLanguages }: { churchId: string; canOperate: boolean; userId: string; enabledLanguages?: string[] }) {
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({
    queryKey: ["church-sessions", churchId],
    queryFn: async () => {
      const s = await supabase.from("sessions").select("*").eq("church_id", churchId).order("created_at", { ascending: false });
      if (s.error) throw s.error;
      const ids = s.data.map((x) => x.id);
      const l = ids.length ? await supabase.from("listener_connections").select("session_id, last_seen_at, left_at").in("session_id", ids) : { data: [] };
      return { sessions: s.data, listeners: l.data ?? [] };
    },
  });
  const sessions = data?.sessions ?? [];
  const running = sessions.filter((s) => s.status === "live" || s.status === "paused");
  const stats = [
    ["Total sessions", sessions.length],
    ["Active sessions", running.length],
    ["Connected listeners", (data?.listeners ?? []).filter(isActiveListener).length],
    ["Active channels", running.reduce((n, s) => n + s.target_languages.length, 0)],
    ["Interpretation time", fmtDuration(sessions.reduce((n, s) => n + sessionSeconds(s), 0))],
  ] as const;

  return (
    <div className="mt-6 space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-2 font-display text-2xl tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">Sessions</h2>
          {canOperate && !creating && (
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> New session</button>
          )}
        </div>
        {creating && <NewSession churchId={churchId} userId={userId} onCancel={() => setCreating(false)} enabledLanguages={enabledLanguages} />}
        <ul className="mt-4 divide-y rounded-3xl border bg-card shadow-card">
          {sessions.length === 0 && <li className="p-6 text-sm text-muted-foreground">No sessions yet.</li>}
          {sessions.map((s) => (
            <li key={s.id}>
              <Link to="/sessions/$id" params={{ id: s.id }} className="flex items-center gap-4 p-5 hover:bg-secondary/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · {s.target_languages.length} languages</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs ${s.status === "live" ? "bg-live text-primary-foreground" : "bg-secondary"}`}>{STATUS_TEXT[s.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NewSession({ churchId, userId, onCancel, enabledLanguages }: { churchId: string; userId: string; onCancel: () => void; enabledLanguages: string[] | undefined }) {
  // Only languages the church has enabled in Language Settings are offered.
  const offered = ACTIVE_TARGET_LANGUAGES.filter((l) => !enabledLanguages || enabledLanguages.includes(l.code));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("en");
  const [targets, setTargets] = useState<string[]>(TESTED_LANGUAGE_CODES.filter((c) => offered.some((l) => l.code === c)));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = targets.filter((c) => c !== source);
    if (!t.length) { toast.error("Pick at least one target language"); return; }
    setBusy(true);
    const { data, error } = await supabase.from("sessions")
      .insert({ church_id: churchId, title, source_language: source, target_languages: t, created_by: userId })
      .select("id").single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["church-sessions", churchId] });
    navigate({ to: "/sessions/$id", params: { id: data.id } });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-5 rounded-3xl border bg-card p-6 shadow-card">
      <div className="space-y-1.5"><Label htmlFor="title">Service title</Label><Input id="title" placeholder="Sunday Service" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div className="space-y-1.5">
        <Label htmlFor="src">Preacher speaks</Label>
        <select id="src" value={source} onChange={(e) => setSource(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
          {SOURCE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Interpret into</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {offered.filter((l) => l.code !== source).map((l) => {
            const soon = isComingSoon(l.code);
            return (
              <label key={l.code} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${soon ? "text-muted-foreground" : ""}`}>
                <Checkbox disabled={soon} checked={!soon && targets.includes(l.code)} onCheckedChange={(v) => setTargets(v ? [...targets, l.code] : targets.filter((c) => c !== l.code))} />
                {l.name}{soon && <span className="ml-auto font-mono text-[10px] uppercase">Coming soon</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Creating…" : "Create session"}</button>
        <button type="button" onClick={onCancel} className="rounded-full border px-5 py-2.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}
