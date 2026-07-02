import { describe, expect, it } from "vitest";
import { allocateByWeight, formatCents, gstFromExclusive, gstFromInclusive } from "../src/money.js";

describe("allocateByWeight", () => {
  it("splits evenly divisible totals exactly", () => {
    expect(allocateByWeight(1000, [1, 1, 1, 1])).toEqual([250, 250, 250, 250]);
  });

  it("always sums exactly to the total (largest remainder)", () => {
    const cases: [number, number[]][] = [
      [1000, [1, 1, 1]],
      [100, [3, 3, 3]],
      [999, [7, 11, 13]],
      [1, [1, 1, 1, 1, 1]],
      [4_800_000, [20, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]], // shop lot double weight
      [123457, [17, 29, 31, 41, 53]],
    ];
    for (const [total, weights] of cases) {
      const shares = allocateByWeight(total, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(shares.every((s) => s >= 0)).toBe(true);
    }
  });

  it("gives larger shares to larger weights", () => {
    const [a, b] = allocateByWeight(1001, [2, 1]);
    expect(a).toBeGreaterThan(b!);
  });

  it("is deterministic on ties (earlier index gets the extra cent)", () => {
    expect(allocateByWeight(101, [1, 1])).toEqual([51, 50]);
  });

  it("handles zero weights among positive ones", () => {
    expect(allocateByWeight(100, [0, 1])).toEqual([0, 100]);
  });

  it("rejects invalid input", () => {
    expect(() => allocateByWeight(100, [])).toThrow();
    expect(() => allocateByWeight(100, [0, 0])).toThrow();
    expect(() => allocateByWeight(100.5, [1])).toThrow();
    expect(() => allocateByWeight(100, [-1, 2])).toThrow();
  });
});

describe("gst", () => {
  it("computes 10% GST from exclusive amounts", () => {
    expect(gstFromExclusive(10_000)).toBe(1_000);
    expect(gstFromExclusive(1)).toBe(0);
    expect(gstFromExclusive(15)).toBe(2); // 1.5 rounds half-up
  });

  it("extracts 1/11 GST from inclusive amounts", () => {
    expect(gstFromInclusive(11_000)).toBe(1_000);
    expect(gstFromInclusive(10)).toBe(1);
  });
});

describe("formatCents", () => {
  it("formats AUD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-50)).toBe("-$0.50");
    expect(formatCents(5)).toBe("$0.05");
  });
});
