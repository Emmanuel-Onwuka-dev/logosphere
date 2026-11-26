import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const KIND_LABEL: Record<string, string> = { stt_seconds: "Speech-to-text (minutes)", translation_chars: "Translated characters", tts_chars: "Spoken characters" };
const PROVIDER_LABEL: Record<string, string> = { deepgram: "Deepgram", deepl: "DeepL", assemblyai: "AssemblyAI" };

/** Usage for the last 30 days, summed from the usage records written by each service. */
export function UsagePanel({ churchId }: { churchId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["usage-30d", churchId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await (supabase as any).from("usage_events")
        .select("kind, provider, quantity, source").eq("church_id", churchId).gte("created_at", since).limit(10000);
      if (error) throw error;
      return (data ?? []) as { kind: string; provider: string; quantity: number; source: string }[];
    },
  });

  const totals = new Map<string, { kind: string; provider: string; quantity: number }>();
  for (const row of data ?? []) {
    const key = `${row.kind}|${row.provider}`;
    const t = totals.get(key) ?? { kind: row.kind, provider: row.provider, quantity: 0 };
    t.quantity += Number(row.quantity);
    totals.set(key, t);
  }
  const rows = [...totals.values()].map((t) => t.kind === "stt_seconds" ? { ...t, quantity: t.quantity / 60 } : t);

  return (
    <section className="mt-10 rounded-3xl border bg-card p-6 shadow-card">
      <h2 className="font-display text-2xl">Usage, last 30 days</h2>
      <p className="mt-1 text-xs text-muted-foreground">Counted when each service runs. Live, recorded and outreach use are all included.</p>
      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No usage in the last 30 days.</p>
        : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-2">Measure</th><th>Service</th><th className="text-right">Total</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.provider}`}>
                  <td className="py-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td>{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                  <td className="text-right tabular-nums">{Math.round(r.quantity).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
