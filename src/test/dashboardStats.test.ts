import { describe, expect, it } from "vitest";
import { dashboardStats } from "@/lib/dashboardStats";

const now = Date.parse("2026-11-25T12:00:00Z");

describe("dashboardStats", () => {
  it("counts sessions, active sessions and hours from real timestamps", () => {
    const s = dashboardStats({
      now,
      sessions: [
        { id: "a", status: "ended", started_at: "2026-11-25T10:00:00Z", ended_at: "2026-11-25T11:00:00Z" },
        { id: "b", status: "live", started_at: "2026-11-25T11:30:00Z", ended_at: null },
        { id: "c", status: "draft", started_at: null, ended_at: null },
      ],
      recordings: [{ status: "ready" }, { status: "processing" }],
      listeners: [],
      outreachReplies: 4,
      enabledLanguages: ["fr", "es"],
    });
    expect(s.totalSessions).toBe(3);
    expect(s.activeSessions).toBe(1);
    expect(s.interpretationHours).toBe(1.5);
    expect(s.totalRecordings).toBe(2);
    expect(s.translatedRecordings).toBe(1);
    expect(s.outreachReplies).toBe(4);
    expect(s.languagesEnabled).toBe(2);
  });

  it("counts only listeners who are still connected to one of the church's sessions", () => {
    const s = dashboardStats({
      now,
      sessions: [{ id: "a", status: "live", started_at: null, ended_at: null }],
      recordings: [],
      listeners: [
        { session_id: "a", left_at: null, last_seen_at: new Date(now - 10_000).toISOString() },
        { session_id: "a", left_at: null, last_seen_at: new Date(now - 300_000).toISOString() },
        { session_id: "a", left_at: new Date(now).toISOString(), last_seen_at: new Date(now).toISOString() },
        { session_id: "other", left_at: null, last_seen_at: new Date(now).toISOString() },
      ],
      outreachReplies: 0,
      enabledLanguages: [],
    });
    expect(s.connectedListeners).toBe(1);
  });
});
