import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, LogOut, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Logosphere" },
      { name: "description", content: "Manage your church, team and interpretation sessions on Logosphere." },
      { property: "og:title", content: "Dashboard — Logosphere" },
      { property: "og:description", content: "Your Logosphere church dashboard." },
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
  const navigate = useNavigate();

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

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border-[1.5px] border-foreground"><Radio className="size-4" /></span>
            <span className="font-display text-xl tracking-tight">Logosphere</span>
          </Link>
          <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm"><LogOut className="size-3.5" /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-12">
        {isLoading || !data ? <p className="text-muted-foreground">Loading…</p> : (
          <>
            <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Signed in as {user.email}</p>
            <h1 className="mt-2 font-display text-4xl">Welcome, {data.profile?.display_name ?? "friend"}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...new Set(data.roles.map((r) => r.role))].map((r) => (
                <span key={r} className="rounded-full bg-secondary px-3 py-1 text-xs">{ROLE_LABEL[r]}</span>
              ))}
            </div>
            <div className="mt-10">
              {data.church ? (
                <div className="rounded-3xl border bg-card p-7 shadow-card">
                  <Building2 className="size-5" />
                  <p className="mt-6 font-display text-3xl">{data.church.name}</p>
                  <p className="mt-1 text-muted-foreground">{[data.church.city, data.church.country].filter(Boolean).join(" · ")}</p>
                  <p className="mt-6 text-sm text-muted-foreground">Live sessions and team invites are coming in the next phase.</p>
                </div>
              ) : <RegisterChurch onDone={() => qc.invalidateQueries({ queryKey: ["me"] })} />}
            </div>
          </>
        )}
      </main>
    </div>
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
      <p className="text-sm text-muted-foreground">You'll become its church admin.</p>
      <div className="space-y-1.5"><Label htmlFor="cn">Church name</Label><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="city">City</Label><Input id="city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ctry">Country</Label><Input id="ctry" value={country} onChange={(e) => setCountry(e.target.value)} /></div>
      </div>
      <button disabled={busy} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Register church"}</button>
    </form>
  );
}
