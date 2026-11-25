import { describe, expect, it } from "vitest";
import { encodeWavAt, placeClips } from "@/lib/wav";

describe("encodeWavAt", () => {
  it("writes a valid 16-bit mono header at the requested rate", () => {
    const wav = encodeWavAt(new Float32Array([0, 0.5, -0.5, 1]), 24000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(wav.length).toBe(52);
  });
});

describe("placeClips", () => {
  it("puts each clip at its start time and keeps the order", () => {
    const out = placeClips([
      { start: 0, samples: new Float32Array([0.1, 0.1]), rate: 4 },
      { start: 1, samples: new Float32Array([0.5]), rate: 4 },
    ], 4);
    expect(out.length).toBe(5);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[4]).toBeCloseTo(0.5);
    expect(out[2]).toBe(0);
  });
});
