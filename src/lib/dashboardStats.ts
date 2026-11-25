export type StatSession = { id: string; status: "draft" | "live" | "paused" | "ended"; started_at: string | null; ended_at: string | null };
export type StatRecording = { status: "processing" | "ready" | "failed" };
export type StatListener = { session_id: string; left_at: string | null; last_seen_at: string };

/** Seconds a session has run; a live session runs until `now`. */
export function sessionSeconds(s: StatSession, now: number) {
  if (!s.started_at) return 0;
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at ? new Date(s.ended_at).getTime() : s.status === "ended" ? start : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** A listener counts as connected if they have not left and were seen in the last 60 seconds. */
export const LISTENER_STALE_MS = 60_000;

/**
 * Dashboard figures computed only from rows the signed-in user can read.
 * Nothing here is estimated or hard-coded.
 */
export function dashboardStats(input: {
  sessions: StatSession[];
  recordings: StatRecording[];
  listeners: StatListener[];
  outreachReplies: number;
  enabledLanguages: string[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const sessionIds = new Set(input.sessions.map((s) => s.id));
  const connected = input.listeners.filter((l) =>
    sessionIds.has(l.session_id) && l.left_at === null && now - new Date(l.last_seen_at).getTime() < LISTENER_STALE_MS,
  ).length;
  // Durations use the same `now` as the listener check, so the figures agree with each other.
  const seconds = input.sessions.reduce((sum, s) => sum + sessionSeconds(s, now), 0);
  return {
    totalSessions: input.sessions.length,
    activeSessions: input.sessions.filter((s) => s.status === "live" || s.status === "paused").length,
    connectedListeners: connected,
    totalRecordings: input.recordings.length,
    translatedRecordings: input.recordings.filter((r) => r.status === "ready").length,
    interpretationHours: Math.round((seconds / 3600) * 10) / 10,
    outreachReplies: input.outreachReplies,
    languagesEnabled: input.enabledLanguages.length,
  };
}
