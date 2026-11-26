export type UsageKind = "stt_seconds" | "translation_chars" | "tts_chars";
export type UsageSource = "live" | "recording" | "reply";

/**
 * Records billable usage for a church. Never throws: a failed usage write must not break interpretation,
 * but it is logged so the gap can be found.
 */
export async function recordUsage(churchId: string, kind: UsageKind, provider: string, quantity: number, source: UsageSource) {
  if (!(quantity > 0)) return;
  try {
    const { workerDb } = await import("@/lib/worker-db.server");
    const { error } = await (workerDb() as any).from("usage_events").insert({ church_id: churchId, kind, provider, quantity: Math.round(quantity * 100) / 100, source });
    if (error) console.warn("usage not recorded:", error.message);
  } catch (e) {
    console.warn("usage not recorded:", e instanceof Error ? e.message : e);
  }
}
