import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { useChurchContext } from "@/lib/churchContext";
import { TARGET_LANGUAGES, TESTED_LANGUAGE_CODES, STATUS_LABEL, capabilityOf } from "@/lib/languages";

export const Route = createFileRoute("/_authenticated/languages")({
  head: () => ({ meta: [{ title: "Language settings — Logosphere" }] }),
  component: LanguagesPage,
});

/**
 * Church-level language settings. A language can only be enabled once it is verified (speech, translation and voice).
 * Those verified languages are listed in TESTED_LANGUAGE_CODES; everything else stays unavailable.
 */
function LanguagesPage() {
  const { data: ctx, isLoading } = useChurchContext();
  const church = ctx?.church ?? null;
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (church) setEnabled(church.enabled_languages.filter((c) => TESTED_LANGUAGE_CODES.includes(c))); }, [church?.id]);

  async function save() {
    if (!church) return;
    setBusy(true);
    const { error } = await (supabase as any).from("churches").update({ enabled_languages: enabled }).eq("id", church.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Language settings saved");
    qc.invalidateQueries({ queryKey: ["church-context"] });
  }

  return (
    <AppShell active="Language Settings">
      <h1 className="font-display text-4xl">Language settings</h1>
      <p className="mt-2 text-muted-foreground">Choose which verified languages your congregation can hear. English is the preaching language.</p>
      {isLoading || !ctx ? <p className="mt-8 text-muted-foreground">Loading…</p> : !church ? (
        <p className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">Register a church on the dashboard first.</p>
      ) : (
        <div className="mt-8 max-w-2xl space-y-3">
          {TARGET_LANGUAGES.map((l) => {
            const verified = TESTED_LANGUAGE_CODES.includes(l.code);
            const on = enabled.includes(l.code);
            return (
              <div key={l.code} className="flex items-center justify-between gap-4 rounded-2xl border bg-card p-5">
                <div>
                  <p className="font-medium">{l.name} <span className="text-muted-foreground">· {l.native}</span></p>
                  <p className="text-xs text-muted-foreground">{verified ? "Verified: speech, translation and voice" : `${STATUS_LABEL[l.status]}. Not available yet.`}</p>
                  <p className="mt-1 flex gap-3 text-xs"><span>{capabilityOf(l.code).speech ? "✓" : "✗"} Speech</span><span>{capabilityOf(l.code).translation ? "✓" : "✗"} Translation</span><span>{capabilityOf(l.code).voice ? "✓" : "✗"} Voice</span></p>
                </div>
                <button
                  type="button"
                  disabled={!verified || !ctx.canAdmin}
                  aria-pressed={on}
                  onClick={() => setEnabled((e) => on ? e.filter((c) => c !== l.code) : [...e, l.code])}
                  className={`rounded-full border px-4 py-2 text-sm disabled:opacity-50 ${on ? "border-foreground bg-foreground text-background" : "bg-background"}`}
                >
                  {verified ? (on ? "Enabled" : "Disabled") : "Coming soon"}
                </button>
              </div>
            );
          })}
          {ctx.canAdmin ? (
            <button onClick={save} disabled={busy} className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : "Save language settings"}</button>
          ) : <p className="text-sm text-muted-foreground">Only a church administrator can change language settings.</p>}
        </div>
      )}
    </AppShell>
  );
}
