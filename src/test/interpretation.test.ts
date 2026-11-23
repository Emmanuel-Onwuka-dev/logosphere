import { describe, expect, it } from "vitest";
import { delayStats, findCuts, schedulePlayback } from "@/lib/interpretation";

const RATE = 1000;
function speech(seconds: number, pauses: [number, number][]) {
  const s = new Float32Array(seconds * RATE);
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE;
    s[i] = pauses.some(([a, b]) => t >= a && t < b) ? 0 : 0.5 * Math.sin(i);
  }
  return s;
}

describe("pause-aware cuts", () => {
  it("cuts inside a 300 ms pause near the 8 s mark", () => {
    const cuts = findCuts(speech(20, [[9, 9.4]]), RATE);
    expect(cuts[0]?.atPause).toBe(true);
    expect(cuts[0]?.endSeconds).toBeCloseTo(9.2, 1);
  });
  it("ignores pauses shorter than 300 ms", () => {
    const cuts = findCuts(speech(20, [[8.5, 8.7]]), RATE);
    expect(cuts[0]).toMatchObject({ endSeconds: 8, atPause: false });
  });
  it("falls back to 8 s when the pause is more than 2 s away", () => {
    const cuts = findCuts(speech(20, [[11, 11.5]]), RATE);
    expect(cuts[0]).toMatchObject({ endSeconds: 8, atPause: false });
  });
});

describe("ordered playback", () => {
  it("waits for a late piece instead of skipping ahead, with no overlap", () => {
    const slots = schedulePlayback([
      { index: 0, readyMs: 1000, audioSeconds: 5, failed: false },
      { index: 1, readyMs: 9000, audioSeconds: 5, failed: false },
      { index: 2, readyMs: 2000, audioSeconds: 5, failed: false },
    ]);
    expect(slots.map((s) => s.playStartMs)).toEqual([1000, 9000, 14000]);
  });
  it("plays a failed piece as silence of the piece length, then continues", () => {
    const slots = schedulePlayback([
      { index: 0, readyMs: 0, audioSeconds: 8, failed: true },
      { index: 1, readyMs: 0, audioSeconds: 3, failed: false },
    ]);
    expect(slots[1]?.playStartMs).toBe(8000);
  });
  it("reports change from start to end", () => {
    expect(delayStats([5000, 5000, 5000, 7000, 7000, 7000, 7000, 7000])?.changeMs).toBe(2000);
  });
});
