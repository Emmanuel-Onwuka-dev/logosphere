import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";

export const Route = createFileRoute("/_authenticated/organisation")({
  head: () => ({ meta: [{ title: "Organisation — Logosphere" }] }),
  component: OrganisationPage,
});

const ROLE_LABEL: Record<string, string> = { church_admin: "Church admin", media_operator: "Media operator", platform_admin: "Platform admin" };

function OrganisationPage() {
  const { data: ctx, isLoading } = useChurchContext();
  const church = ctx?.church ?? null;
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (church) { setName(church.name); setCity(church.city ?? ""); setCountry(church.country ?? ""); }
  }, [church?.id]);

  const { data: members = [] } = useQuery({
    queryKey: ["church-members", church?.id],
    enabled: !!church,
    queryFn: async () => {
      const [roles, profiles] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").eq("church_id", church!.id),
        supabase.from("profiles").select("id, display_name").eq("church_id", church!.id),
      ]);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name ?? "Unnamed member"]));
      const byUser = new Map<string, string[]>();
      for (const r of roles.data ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
      return [...byUser.entries()].map(([id, rs]) => ({ id, name: names.get(id) ?? "Member", roles: rs }));
    },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!church) return;
    setBusy(true);
    const { error } = await (supabase as any).from("churches").update({ name: name.trim(), city: city.trim() || null, country: country.trim() || null }).eq("id", church.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Organisation saved");
    qc.invalidateQueries({ queryKey: ["church-context"] });
  }

  return (
    <AppShell active="Organisation">
      <h1 className="font-display text-4xl">Organisation</h1>
      <p className="mt-2 text-muted-foreground">Your church's details, default language and members.</p>
      {isLoading || !ctx ? <p className="mt-8 text-muted-foreground">Loading…</p> : !church ? (
        <p className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
          <form onSubmit={save} className="grid gap-5 rounded-3xl border bg-card p-7 shadow-card">
            <div className="space-y-1.5"><Label htmlFor="on">Church or organisation name</Label><Input id="on" value={name} onChange={(e) => setName(e.target.value)} disabled={!ctx.canAdmin} maxLength={200} required /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="oc">City</Label><Input id="oc" value={city} onChange={(e) => setCity(e.target.value)} disabled={!ctx.canAdmin} /></div>
              <div className="space-y-1.5"><Label htmlFor="ocy">Country</Label><Input id="ocy" value={country} onChange={(e) => setCountry(e.target.value)} disabled={!ctx.canAdmin} /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds">Default source language</Label>
              <select id="ds" value={church.default_source_language} disabled className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm">
                <option value="en">English</option>
              </select>
              <p className="text-xs text-muted-foreground">English is the only preaching language at the moment.</p>
            </div>
            <div className="space-y-1.5"><Label>Logo</Label><p className="text-xs text-muted-foreground">Logo upload is not available yet.</p></div>
            {ctx.canAdmin ? (
              <button disabled={busy} className="justify-self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Save organisation"}</button>
            ) : <p className="text-sm text-muted-foreground">Only a church administrator can change these details.</p>}
          </form>

          <section className="rounded-3xl border bg-card p-7 shadow-card">
            <h2 className="font-display text-2xl">Members</h2>
            <ul className="mt-4 divide-y">
              {members.map((m) => (
                <li key={m.id} className="py-3">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}</p>
                </li>
              ))}
            </ul>
            {members.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No members yet.</p>}
            <p className="mt-4 text-xs text-muted-foreground">Inviting members and changing roles is not available yet.</p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
