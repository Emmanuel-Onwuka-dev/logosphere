import { describe, expect, it } from "vitest";
import { AUTO_FAST_SPEED, nextFast, speedFor } from "@/lib/interpretation";

describe("adaptive playback speed", () => {
  it("switches on only above 5 s of backlog", () => {
    expect(nextFast(5.01, false)).toBe(true);
    expect(nextFast(5, false)).toBe(false);
  });
  it("keeps its state between 2 s and 5 s", () => {
    expect(nextFast(3, true)).toBe(true);
    expect(nextFast(3, false)).toBe(false);
  });
  it("switches off below 2 s", () => {
    expect(nextFast(1.9, true)).toBe(false);
  });
  it("uses 1.15x only while fast, and never below the base speed", () => {
    expect(speedFor(1, false)).toBe(1);
    expect(speedFor(1, true)).toBe(AUTO_FAST_SPEED);
    expect(speedFor(1.2, true)).toBe(1.2);
  });
});
