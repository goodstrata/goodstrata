import { describe, expect, it } from "vitest";
import { isOccupiableLot, schemeTier } from "../src/enums.js";

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

describe("isOccupiableLot", () => {
  it("counts residential and commercial lots toward the OC Act tally", () => {
    expect(isOccupiableLot("residential")).toBe(true);
    expect(isOccupiableLot("commercial")).toBe(true);
  });

  it("excludes accessory lots (carpark/storage) so tier isn't over-stated", () => {
    // A 100-residential block with 60 carpark + 20 storage lots is 180 total
    // lots but 100 occupiable → tier 2, not tier 1. Feeding total lots would
    // wrongly impose T1 obligations.
    expect(isOccupiableLot("carpark")).toBe(false);
    expect(isOccupiableLot("storage")).toBe(false);
    const total = ["residential", "commercial", "carpark", "storage"] as const;
    const occupiable = total.filter(isOccupiableLot).length;
    expect(occupiable).toBe(2);
  });
});
