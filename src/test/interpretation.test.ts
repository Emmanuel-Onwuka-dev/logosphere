import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, clampSpeed, delayStats, findCuts, growthPerHourMs, lengthPercent, reviewCsv, schedulePlayback, sectionStats, withOneRetry } from "@/lib/interpretation";
import { timeStretch } from "@/lib/timestretch";

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
    expect(cuts[0]?.type).toBe("pause");
    expect(cuts[0]?.endSeconds).toBeCloseTo(9.2, 1);
  });
  it("ignores pauses shorter than 300 ms", () => {
    const cuts = findCuts(speech(20, [[8.5, 8.7]]), RATE);
    expect(cuts[0]).toMatchObject({ endSeconds: 8, type: "forced" });
  });
  it("extends to the next pause within 4 s when none is within 2 s", () => {
    const cuts = findCuts(speech(30, [[11, 11.5]]), RATE);
    expect(cuts[0]).toMatchObject({ type: "extended" });
    expect(cuts[0]?.endSeconds).toBeCloseTo(11.25, 1);
  });
  it("forces the 8 s cut only when no pause is within 4 s", () => {
    const cuts = findCuts(speech(30, [[12.5, 13]]), RATE);
    expect(cuts[0]).toMatchObject({ endSeconds: 8, type: "forced" });
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

describe("playback speed", () => {
  it("defaults French to 1.10x and Spanish to 1.00x, limited to 1.00–1.20x", () => {
    expect(DEFAULT_SPEED).toEqual({ fr: 1.1, es: 1 });
    expect(clampSpeed(1.5)).toBe(1.2);
    expect(clampSpeed(0.9)).toBe(1);
  });
  it("shortens audio by the speed without changing pitch", () => {
    const rate = 8000; const hz = 200;
    const tone = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
    const out = timeStretch(tone, rate, 1.1);
    expect(out.length).toBe(Math.round(tone.length / 1.1));
    let crossings = 0;
    for (let i = 1000; i < out.length - 1000; i++) if ((out[i - 1] ?? 0) < 0 && (out[i] ?? 0) >= 0) crossings++;
    expect(crossings / ((out.length - 2000) / rate)).toBeGreaterThan(hz * 0.97);
    expect(crossings / ((out.length - 2000) / rate)).toBeLessThan(hz * 1.03);
  });
});

describe("long-test report", () => {
  it("splits delays into first 3 min, middle and last 3 min", () => {
    const rows = [0, 100, 179, 600, 1050, 1199].map((t, i) => ({ speechStartSeconds: t, delayMs: (i + 1) * 1000 }));
    const s = sectionStats(rows, 1200);
    expect([s.first?.averageMs, s.middle?.averageMs, s.last?.averageMs]).toEqual([2000, 4000, 5500]);
  });
  it("extrapolates growth to one hour and reports length as a percentage", () => {
    expect(growthPerHourMs(4000, 1200)).toBe(12000);
    expect(lengthPercent(197, 180)).toBe(109.4);
  });
  it("exports review CSV with quoted text", () => {
    expect(reviewCsv([{ language: "fr", piece: 1, cutType: "pause", english: 'He said, "go"', translation: "Il a dit", mark: "acceptable" }]))
      .toBe('language,piece,cut_type,english,translation,review\r\nfr,1,pause,"He said, ""go""",Il a dit,acceptable\r\n');
  });
});

describe("dropped connections", () => {
  it("retries exactly once, then fails", async () => {
    let calls = 0; const log: string[] = [];
    await expect(withOneRetry(async () => { calls++; throw new Error("ECONNRESET"); }, (m) => log.push(m))).rejects.toThrow();
    expect([calls, log.length]).toEqual([2, 1]);
  });
  it("does not retry a rejection", async () => {
    let calls = 0;
    await expect(withOneRetry(async () => { calls++; throw new Error("Deepgram rejected transcription"); }, () => {})).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
