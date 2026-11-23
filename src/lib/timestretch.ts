/** Pitch-preserving speed change (WSOLA): shortens speech by `speed` without raising the voice. */
export function timeStretch(input: Float32Array, rate: number, speed: number): Float32Array<ArrayBuffer> {
  if (!(speed > 0)) throw new Error("Speed must be positive");
  if (Math.abs(speed - 1) < 1e-6 || input.length === 0) return input.slice();
  const win = Math.max(16, Math.round(rate * 0.03));
  const hop = win >> 1;
  const tol = Math.round(rate * 0.008);
  const outLen = Math.round(input.length / speed);
  if (input.length < win * 2) return input.slice(0, outLen);
  const out = new Float32Array(outLen + win);
  const norm = new Float32Array(outLen + win);
  const w = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
  const last = input.length - win;
  let prev = 0;
  for (let k = 0; k * hop < outLen; k++) {
    const nominal = Math.min(last, Math.round(k * hop * speed));
    let best = nominal;
    if (k > 0) {
      const ref = Math.min(last, prev + hop);
      let bestScore = -Infinity;
      for (let c = Math.max(0, nominal - tol); c <= Math.min(last, nominal + tol); c++) {
        let s = 0;
        for (let i = 0; i < win; i += 4) s += (input[c + i] ?? 0) * (input[ref + i] ?? 0);
        if (s > bestScore) { bestScore = s; best = c; }
      }
    }
    const o = k * hop;
    for (let i = 0; i < win; i++) { out[o + i]! += w[i]! * (input[best + i] ?? 0); norm[o + i]! += w[i]!; }
    prev = best;
  }
  for (let i = 0; i < outLen; i++) out[i] = norm[i]! > 1e-3 ? out[i]! / norm[i]! : out[i]!;
  return out.slice(0, outLen);
}
