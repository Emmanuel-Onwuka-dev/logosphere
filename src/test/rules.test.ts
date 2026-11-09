import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { isActiveListener, sessionSeconds, fmtDuration } from "@/lib/sessions";
import { TARGET_LANGUAGES } from "@/lib/languages";

describe("listener counting", () => {
  it("counts a listener seen 1 minute ago", () => {
    expect(isActiveListener({ left_at: null, last_seen_at: new Date(Date.now() - 60_000).toISOString() })).toBe(true);
  });
  it("drops a listener not seen for 3 minutes", () => {
    expect(isActiveListener({ left_at: null, last_seen_at: new Date(Date.now() - 180_000).toISOString() })).toBe(false);
  });
  it("drops a listener who left", () => {
    expect(isActiveListener({ left_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })).toBe(false);
  });
});

describe("session duration", () => {
  it("is 0 before start", () => expect(sessionSeconds({ started_at: null, ended_at: null, status: "draft" })).toBe(0));
  it("measures start to end", () =>
    expect(sessionSeconds({ started_at: "2026-01-01T10:00:00Z", ended_at: "2026-01-01T11:30:00Z", status: "ended" })).toBe(5400));
  it("formats 1h 30m", () => expect(fmtDuration(5400)).toBe("1h 30m"));
});

describe("language readiness", () => {
  it("offers exactly fr, es, pt, ig, yo, ha", () =>
    expect(TARGET_LANGUAGES.map((l) => l.code)).toEqual(["fr", "es", "pt", "ig", "yo", "ha"]));
  it("marks no language available while no engine is verified", () =>
    expect(TARGET_LANGUAGES.some((l) => l.status === "available" || l.status === "ready")).toBe(false));
  it("routes Nigerian languages through the cascaded pipeline", () =>
    expect(TARGET_LANGUAGES.filter((l) => l.region === "Nigerian").every((l) => l.pipeline === "cascaded")).toBe(true));
});
