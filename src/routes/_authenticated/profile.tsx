import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TESTED_LANGUAGE_CODES, TARGET_LANGUAGES } from "@/lib/languages";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Logosphere" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { data: ctx, isLoading } = useChurchContext();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ctx?.profile) { setName(ctx.profile.display_name ?? ""); setLanguage(ctx.profile.preferred_language ?? "en"); }
  }, [ctx?.profile?.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx) return;
    setBusy(true);
    const { error } = await (supabase as any).from("profiles").update({ display_name: name.trim(), preferred_language: language }).eq("id", ctx.userId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["church-context"] });
  }

  const languageOptions = [{ code: "en", name: "English" }, ...TARGET_LANGUAGES.filter((l) => TESTED_LANGUAGE_CODES.includes(l.code))];

  return (
    <AppShell active="Profile">
      <h1 className="font-display text-4xl">Profile</h1>
      <p className="mt-2 text-muted-foreground">Your name and preferences. Your church and role are managed by your church administrator.</p>
      {isLoading || !ctx ? <p className="mt-8 text-muted-foreground">Loading…</p> : (
        <form onSubmit={save} className="mt-8 grid max-w-2xl gap-5 rounded-3xl border bg-card p-7 shadow-card">
          <div className="space-y-1.5"><Label htmlFor="pn">Name</Label><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></div>
          <div className="space-y-1.5"><Label>Email</Label><p className="rounded-xl border bg-background px-3 py-2.5 text-sm text-muted-foreground">{ctx.email}</p></div>
          <div className="space-y-1.5">
            <Label htmlFor="pl">Preferred language</Label>
            <select id="pl" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm">
              {languageOptions.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>Church</Label><p className="text-sm text-muted-foreground">{ctx.church?.name ?? "Not linked to a church yet"}</p></div>
          <div className="space-y-1.5"><Label>Roles</Label><p className="text-sm text-muted-foreground">{ctx.roles.length ? ctx.roles.join(", ").replace(/_/g, " ") : "No roles yet"}</p></div>
          <p className="text-xs text-muted-foreground">Profile photos are not available yet.</p>
          <button disabled={busy} className="justify-self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Save profile"}</button>
        </form>
      )}
    </AppShell>
  );
}
