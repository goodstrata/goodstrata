import { describe, expect, it } from "vitest";
import { ARREARS_STAGES, arrearsStage, stageKind } from "../src/engines/arrears-ladder.js";
import { interestAccrued } from "../src/engines/interest.js";
import { calculateLevyRun } from "../src/engines/levy-calc.js";
import { matchPayment } from "../src/engines/reconcile.js";

describe("calculateLevyRun", () => {
  // The Fitzroy shape: 12 lots, shop at double liability — doesn't divide evenly.
  const fitzroyLots = [
    { lotId: "L1", liability: 20 },
    ...Array.from({ length: 11 }, (_, i) => ({ lotId: `L${i + 2}`, liability: 10 })),
  ];
  const funds = [
    { fundKind: "admin" as const, annualCents: 4_800_000 },
    { fundKind: "maintenance" as const, annualCents: 1_200_000 },
  ];

  it("sums exactly to the budget across every lot and instalment", () => {
    const run = calculateLevyRun(funds, fitzroyLots, 4);
    expect(run).toHaveLength(48);

    const totalBudget = funds.reduce((a, f) => a + f.annualCents, 0);
    const grandTotal = run.reduce((a, r) => a + r.totalCents, 0);
    expect(grandTotal).toBe(totalBudget);

    // Per fund too:
    for (const fund of funds) {
      const fundTotal = run
        .flatMap((r) => r.lines)
        .filter((l) => l.fundKind === fund.fundKind)
        .reduce((a, l) => a + l.amountCents, 0);
      expect(fundTotal).toBe(fund.annualCents);
    }
  });

  it("each lot's instalments sum exactly to its annual share", () => {
    const run = calculateLevyRun(funds, fitzroyLots, 4);
    // Shop lot: 20/130 of both funds.
    const shopTotal = run.filter((r) => r.lotId === "L1").reduce((a, r) => a + r.totalCents, 0);
    // 20/130 × 6,000,000 = 923,076.92… → largest remainder keeps it within a cent.
    expect(Math.abs(shopTotal - (6_000_000 * 20) / 130)).toBeLessThan(1);
    const instalmentTotals = run.filter((r) => r.lotId === "L1").map((r) => r.totalCents);
    expect(instalmentTotals).toHaveLength(4);
    // No instalment differs from another by more than a cent per fund line (2 lines).
    const min = Math.min(...instalmentTotals);
    const max = Math.max(...instalmentTotals);
    expect(max - min).toBeLessThanOrEqual(2);
  });

  it("handles awkward primes without losing cents", () => {
    const lots = [
      { lotId: "a", liability: 17 },
      { lotId: "b", liability: 29 },
      { lotId: "c", liability: 31 },
    ];
    const run = calculateLevyRun([{ fundKind: "admin", annualCents: 1_000_001 }], lots, 3);
    expect(run.reduce((a, r) => a + r.totalCents, 0)).toBe(1_000_001);
  });

  it("single lot, single instalment gets everything", () => {
    const run = calculateLevyRun(
      [{ fundKind: "admin", annualCents: 12345 }],
      [{ lotId: "only", liability: 1 }],
      1,
    );
    expect(run).toEqual([
      {
        lotId: "only",
        instalment: 1,
        lines: [{ fundKind: "admin", amountCents: 12345 }],
        totalCents: 12345,
      },
    ]);
  });

  it("rejects invalid input", () => {
    expect(() => calculateLevyRun([], [], 4)).toThrow();
    expect(() =>
      calculateLevyRun(
        [{ fundKind: "admin", annualCents: 100 }],
        [{ lotId: "a", liability: 1 }],
        0,
      ),
    ).toThrow();
  });
});

describe("interestAccrued", () => {
  it("computes simple daily interest on actual/365", () => {
    // $1,000 at 10% pa for 365 days = $100
    expect(interestAccrued(100_000, 1000, 365)).toBe(10_000);
    // …and for one day: 100000 × 0.10 / 365 = 27.397 → 27
    expect(interestAccrued(100_000, 1000, 1)).toBe(27);
  });

  it("uses a 365 denominator even across a leap year (2028 has 366 days)", () => {
    // Full leap year overdue: 366 chargeable days.
    expect(interestAccrued(100_000, 1000, 366)).toBe(
      Math.round((100_000 * 1000 * 366) / 3_650_000),
    );
  });

  it("honours grace days and clamps at zero", () => {
    expect(interestAccrued(100_000, 1000, 5, 7)).toBe(0);
    expect(interestAccrued(100_000, 1000, 10, 7)).toBe(interestAccrued(100_000, 1000, 3));
  });

  it("returns 0 for zero/negative principal or rate", () => {
    expect(interestAccrued(0, 1000, 30)).toBe(0);
    expect(interestAccrued(-500, 1000, 30)).toBe(0);
    expect(interestAccrued(100_000, 0, 30)).toBe(0);
  });
});

describe("arrearsStage", () => {
  it("maps the statutory ladder with exact boundaries", () => {
    expect(arrearsStage(0)).toBe(0);
    expect(arrearsStage(1)).toBe(1);
    expect(arrearsStage(13)).toBe(1);
    expect(arrearsStage(14)).toBe(2);
    expect(arrearsStage(29)).toBe(2);
    expect(arrearsStage(30)).toBe(3);
    expect(arrearsStage(59)).toBe(3);
    expect(arrearsStage(60)).toBe(4);
    expect(arrearsStage(400)).toBe(4);
  });

  it("stage kinds line up", () => {
    expect(stageKind(1)).toBe("friendly_reminder");
    expect(stageKind(4)).toBe("recovery_decision");
    expect(stageKind(0)).toBeNull();
    expect(ARREARS_STAGES).toHaveLength(4);
  });
});

describe("matchPayment", () => {
  const notices = [
    { levyNoticeId: "n1", payid: "gs-0001", outstandingCents: 50_000 },
    { levyNoticeId: "n2", payid: "gs-0002", outstandingCents: 50_000 },
    { levyNoticeId: "n3", payid: "gs-0003", outstandingCents: 75_000 },
  ];

  it("matches by payment reference first", () => {
    expect(matchPayment({ payid: "gs-0002", amountCents: 12_345 }, notices)).toEqual({
      kind: "matched",
      levyNoticeId: "n2",
      via: "payid",
    });
  });

  it("falls back to amount only when unambiguous", () => {
    expect(matchPayment({ payid: null, amountCents: 75_000 }, notices)).toEqual({
      kind: "matched",
      levyNoticeId: "n3",
      via: "amount",
    });
    expect(matchPayment({ payid: null, amountCents: 50_000 }, notices)).toMatchObject({
      kind: "unmatched",
    });
  });

  it("never guesses on unknown reference + unknown amount", () => {
    expect(matchPayment({ payid: "gs-9999", amountCents: 11 }, notices)).toMatchObject({
      kind: "unmatched",
    });
  });
});
