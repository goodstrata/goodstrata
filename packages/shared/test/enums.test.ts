import { describe, expect, it } from "vitest";
import { schemeTier } from "../src/enums.js";

describe("schemeTier", () => {
  it("bands occupiable lots to the correct CAV tier at each boundary", () => {
    // T5: 2-lot (and anything below 3)
    expect(schemeTier(2)).toBe(5);
    // T4: 3–9
    expect(schemeTier(3)).toBe(4);
    expect(schemeTier(9)).toBe(4);
    // T3: 10–50 (10 is inclusive — the off-by-one fix)
    expect(schemeTier(10)).toBe(3);
    expect(schemeTier(50)).toBe(3);
    // T2: 51–100
    expect(schemeTier(51)).toBe(2);
    expect(schemeTier(100)).toBe(2);
    // T1: >100
    expect(schemeTier(101)).toBe(1);
  });

  it("treats a services-only OC as T5 regardless of lot count", () => {
    expect(schemeTier(250, true)).toBe(5);
    expect(schemeTier(0, true)).toBe(5);
  });

  it("defaults servicesOnly to false", () => {
    expect(schemeTier(101)).toBe(1);
  });
});
