import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Session = Database["public"]["Tables"]["sessions"]["Row"];
export type SessionStatus = Database["public"]["Enums"]["session_status"];

export const STATUS_TEXT: Record<SessionStatus, string> = { draft: "Ready to start", live: "Live", paused: "Paused", ended: "Ended" };

export function publicLink(code: string) {
  return `${typeof window !== "undefined" ? window.location.origin : ""}/s/${code}`;
}

/** A listener counts as connected if seen in the last minute and hasn't left. */
export const ACTIVE_WINDOW_MS = 60 * 1000;
export function isActiveListener(l: { left_at: string | null; last_seen_at: string }) {
  return !l.left_at && Date.now() - new Date(l.last_seen_at).getTime() < ACTIVE_WINDOW_MS;
}

export function sessionSeconds(s: Pick<Session, "started_at" | "ended_at" | "status">) {
  if (!s.started_at) return 0;
  const end = s.ended_at ? new Date(s.ended_at).getTime() : s.status === "ended" ? new Date(s.started_at).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(s.started_at).getTime()) / 1000));
}

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export async function setStatus(s: Session, status: SessionStatus) {
  const patch: Partial<Session> = { status };
  if (status === "live" && !s.started_at) patch.started_at = new Date().toISOString();
  if (status === "ended") patch.ended_at = new Date().toISOString();
  const { error } = await supabase.from("sessions").update(patch).eq("id", s.id);
  if (error) throw error;
}
