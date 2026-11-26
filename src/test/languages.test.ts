import { describe, expect, it } from "vitest";
import { isVerified, capabilityOf } from "@/lib/languages";

describe("language verification", () => {
  it("verifies French and Spanish only", () => {
    expect(isVerified("fr")).toBe(true);
    expect(isVerified("es")).toBe(true);
  });
  it("keeps Portuguese unverified because there is no voice for it", () => {
    expect(capabilityOf("pt").voice).toBe(false);
    expect(isVerified("pt")).toBe(false);
  });
  it("keeps the Nigerian languages unverified", () => {
    for (const c of ["ig", "yo", "ha"]) expect(isVerified(c)).toBe(false);
  });
});
