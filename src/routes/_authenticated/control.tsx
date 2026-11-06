import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Activity, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from "@/lib/languages";
import { testEndpoint, SECRET_PREFIX } from "@/lib/engines.functions";

export const Route = createFileRoute("/_authenticated/control")({
  head: () => ({
    meta: [
      { title: "AI Engine Control Centre — Logosphere" },
      { name: "description", content: "Register AI providers, engines and endpoints, assign them to languages and monitor health." },
      { property: "og:title", content: "AI Engine Control Centre — Logosphere" },
      { property: "og:description", content: "Technical administration for Logosphere's interpretation engines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlCentre,
});

const db = supabase as any;
const ALL_LANGS = SOURCE_LANGUAGES.map((l) => l.code);
const DEPLOY = ["hosted_api", "self_hosted_gpu", "local_server", "testing_env", "other"];
const ENGINE_TYPES = ["speech_to_speech", "asr", "text_translation", "tts", "voice_generation", "audio_processing", "pipeline"];
const nice = (s: string) => s.replace(/_/g, " ");

type Field = { k: string; label: string; type?: "text" | "number" | "select" | "bool" | "list"; options?: string[]; ref?: string; hint?: string };

function useTable(table: string, order = "created_at") {
  return useQuery({
    queryKey: ["ctl", table],
    queryFn: async () => { const r = await db.from(table).select("*").order(order, { ascending: false }); if (r.error) throw r.error; return r.data as any[]; },
  });
}

function ControlCentre() {
  const { user } = Route.useRouteContext();
  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-platform-admin", user.id],
    queryFn: async () => (await supabase.rpc("has_role", { _user_id: user.id, _role: "platform_admin" })).data ?? false,
  });
  if (isLoading) return null;
  if (!isAdmin) return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
      <div><ShieldAlert className="mx-auto size-8" /><h1 className="mt-3 font-display text-2xl">Platform admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account doesn't have access to the Control Centre.</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm underline">Back to dashboard</Link></div>
    </div>
  );
  return <Admin />;
}

function Admin() {
  const providers = useTable("ai_providers").data ?? [];
  const engines = useTable("ai_engines").data ?? [];
  const opts = (rows: any[], k: string) => rows.map((r) => `${r.id}|${r[k]}`);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
        <Link to="/dashboard" className="text-muted-foreground"><ArrowLeft className="size-4" /></Link>
        <h1 className="font-display text-xl">AI Engine Control Centre</h1>
      </div></header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Tabs defaultValue="health">
          <TabsList className="flex-wrap">
            {["health", "providers", "engines", "endpoints", "assignments"].map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t === "health" ? "System health" : t}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="health"><Health engines={engines} /></TabsContent>
          <TabsContent value="providers"><Manager table="ai_providers" title="Providers" nameKey="name" fields={[
            { k: "name", label: "Provider name" },
            { k: "provider_type", label: "Type", type: "select", options: DEPLOY },
            { k: "status", label: "Status", type: "select", options: ["testing", "active", "disabled"] },
            { k: "notes", label: "Notes" },
          ]} /></TabsContent>
          <TabsContent value="engines"><Manager table="ai_engines" title="Engines & models" nameKey="engine_name" fields={[
            { k: "engine_name", label: "Engine name" },
            { k: "provider_id", label: "Provider", type: "select", ref: "ai_providers", options: opts(providers, "name") },
            { k: "model_id", label: "Model ID" }, { k: "model_version", label: "Model version" },
            { k: "engine_type", label: "Engine type", type: "select", options: ENGINE_TYPES },
            { k: "deployment_type", label: "Deployment", type: "select", options: DEPLOY },
            { k: "supported_languages", label: "Supported languages", type: "list", hint: ALL_LANGS.join(", ") },
            { k: "supported_language_pairs", label: "Language pairs", type: "list", hint: "e.g. en-fr, en-yo" },
            { k: "input_format", label: "Input format", hint: "e.g. pcm16 16kHz" }, { k: "output_format", label: "Output format" },
            { k: "streaming", label: "Streaming", type: "bool" },
            { k: "max_concurrency", label: "Max concurrency", type: "number" }, { k: "timeout_ms", label: "Timeout (ms)", type: "number" },
            { k: "status", label: "Status", type: "select", options: ["disabled", "testing", "operational"] },
          ]} /></TabsContent>
          <TabsContent value="endpoints"><Manager table="inference_endpoints" title="Inference endpoints" nameKey="endpoint_name" testable fields={[
            { k: "endpoint_name", label: "Endpoint name" },
            { k: "engine_id", label: "Engine", type: "select", options: opts(engines, "engine_name") },
            { k: "endpoint_type", label: "Type", type: "select", options: ["http", "websocket", "grpc"] },
            { k: "endpoint_url", label: "API base URL" }, { k: "websocket_url", label: "WebSocket URL" }, { k: "healthcheck_url", label: "Health-check URL" },
            { k: "auth_method", label: "Authentication", type: "select", options: ["none", "bearer", "api_key"] },
            { k: "secret_ref", label: "Secret name", hint: `Name of a server secret starting with ${SECRET_PREFIX} — never paste the key here` },
          ]} /></TabsContent>
          <TabsContent value="assignments"><Manager table="engine_assignments" title="Engine assignments" nameKey="target_language" fields={[
            { k: "engine_id", label: "Engine", type: "select", options: opts(engines, "engine_name") },
            { k: "source_language", label: "From", type: "select", options: ALL_LANGS },
            { k: "target_language", label: "To", type: "select", options: TARGET_LANGUAGES.map((l) => l.code) },
            { k: "processing_mode", label: "Processing mode", type: "select", options: ["direct", "cascaded"] },
            { k: "priority", label: "Priority", type: "number" },
            { k: "enabled", label: "Enabled", type: "bool" },
          ]} engines={engines} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Health({ engines }: { engines: any[] }) {
  const eps = useTable("inference_endpoints").data ?? [];
  const checks = useTable("endpoint_checks", "checked_at").data ?? [];
  const asg = useTable("engine_assignments").data ?? [];
  const recent = checks.slice(0, 50);
  const errRate = recent.length ? Math.round((recent.filter((c) => !c.ok).length / recent.length) * 100) : 0;
  const lat = recent.filter((c) => c.ok && c.latency_ms != null);
  const avg = lat.length ? Math.round(lat.reduce((n, c) => n + c.latency_ms, 0) / lat.length) : null;
  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Engines", engines.length], ["Healthy endpoints", `${eps.filter((e) => e.status === "healthy").length}/${eps.length}`], ["Avg latency", avg != null ? `${avg} ms` : "—"], ["Recent error rate", recent.length ? `${errRate}%` : "—"]].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4 shadow-card"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-2 font-display text-2xl tabular-nums">{v}</p></div>
        ))}
      </div>
      <section className="rounded-3xl border bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Language channels</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {TARGET_LANGUAGES.map((l) => {
            const a = asg.filter((x) => x.target_language === l.code && x.enabled).sort((x, y) => x.priority - y.priority)[0];
            const e = a && engines.find((x) => x.id === a.engine_id);
            return <li key={l.code} className="rounded-xl border p-3 text-sm"><p className="font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{e ? `${e.engine_name} · ${nice(e.status)}` : "No engine assigned"}</p></li>;
          })}
        </ul>
      </section>
      <section className="rounded-3xl border bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Recent connectivity tests</h2>
        {recent.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No tests yet. Add an endpoint and press Test.</p> : (
          <ul className="mt-3 divide-y text-sm">{recent.slice(0, 15).map((c) => {
            const ep = eps.find((e) => e.id === c.endpoint_id);
            return <li key={c.id} className="flex justify-between gap-3 py-2"><span>{ep?.endpoint_name ?? "—"}</span><span className={c.ok ? "" : "text-destructive"}>{c.ok ? `OK · ${c.latency_ms} ms` : c.error}</span><span className="text-xs text-muted-foreground">{new Date(c.checked_at).toLocaleString()}</span></li>;
          })}</ul>
        )}
      </section>
    </div>
  );
}

function Manager({ table, title, fields, nameKey, testable, engines }: { table: string; title: string; fields: Field[]; nameKey: string; testable?: boolean; engines?: any[] }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useTable(table);
  const [editing, setEditing] = useState<any | null>(null);
  const test = useServerFn(testEndpoint);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ctl"] }); };

  async function remove(id: string) {
    if (!confirm("Delete this record?")) return;
    const { error } = await db.from(table).delete().eq("id", id);
    if (error) toast.error(error.message); else refresh();
  }
  async function runTest(id: string) {
    const t = toast.loading("Testing connection…");
    try { const r = await test({ data: { endpointId: id } }); toast[r.ok ? "success" : "error"](r.ok ? `Reachable · ${r.latency_ms} ms` : r.error ?? "Failed", { id: t }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Test failed", { id: t }); }
    refresh();
  }
  const label = (r: any) => table === "engine_assignments" ? `${r.source_language} → ${r.target_language} · ${engines?.find((e) => e.id === r.engine_id)?.engine_name ?? "?"}` : r[nameKey];

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">{title}</h2>
        {!editing && <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> Add</button>}
      </div>
      {editing && <Editor table={table} fields={fields} initial={editing} onDone={() => { setEditing(null); refresh(); }} />}
      <ul className="mt-4 divide-y rounded-3xl border bg-card shadow-card">
        {rows.length === 0 && <li className="p-6 text-sm text-muted-foreground">Nothing here yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
            <button onClick={() => setEditing(r)} className="min-w-0 flex-1 text-left">
              <p className="truncate font-medium">{label(r)}</p>
              <p className="text-xs text-muted-foreground">
                {r.status ? nice(r.status) : r.enabled ? "enabled" : "disabled"}
                {r.last_latency_ms != null && ` · ${r.last_latency_ms} ms`}{r.last_error && ` · ${r.last_error}`}
              </p>
            </button>
            {testable && <button onClick={() => runTest(r.id)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs"><Activity className="size-3.5" /> Test</button>}
            <button onClick={() => remove(r.id)} aria-label="Delete" className="text-muted-foreground"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Editor({ table, fields, initial, onDone }: { table: string; fields: Field[]; initial: any; onDone: () => void }) {
  const [v, setV] = useState<any>(() => {
    const o: any = {};
    for (const f of fields) o[f.k] = initial[f.k] ?? (f.type === "bool" ? false : f.type === "list" ? [] : f.type === "select" ? (f.options?.[0]?.split("|")[0] ?? "") : "");
    return o;
  });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row: any = {};
    for (const f of fields) {
      const x = v[f.k];
      row[f.k] = f.type === "number" ? (x === "" || x == null ? null : Number(x)) : f.type === "list" ? (Array.isArray(x) ? x : String(x).split(",").map((s) => s.trim()).filter(Boolean)) : x === "" ? null : x;
    }
    if (row.secret_ref && !row.secret_ref.startsWith(SECRET_PREFIX)) { toast.error(`Secret name must start with ${SECRET_PREFIX}`); return; }
    setBusy(true);
    const q = initial.id ? db.from(table).update(row).eq("id", initial.id) : db.from(table).insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); onDone(); }
  }
  return (
    <form onSubmit={save} className="mt-4 grid gap-4 rounded-3xl border bg-card p-6 shadow-card sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.k} className="space-y-1.5">
          <Label htmlFor={f.k}>{f.label}</Label>
          {f.type === "select" ? (
            <select id={f.k} value={v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm" required>
              {(f.options ?? []).map((o) => { const [val, lab] = o.split("|"); return <option key={val} value={val}>{nice(lab ?? val ?? "")}</option>; })}
            </select>
          ) : f.type === "bool" ? (
            <div className="pt-2"><Switch id={f.k} checked={!!v[f.k]} onCheckedChange={(c) => setV({ ...v, [f.k]: c })} /></div>
          ) : (
            <Input id={f.k} type={f.type === "number" ? "number" : "text"} value={Array.isArray(v[f.k]) ? v[f.k].join(", ") : v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} required={fields[0]?.k === f.k} />
          )}
          {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={busy} className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onDone} className="rounded-full border px-5 py-2.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}
