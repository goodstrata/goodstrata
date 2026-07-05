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

  it("gives a zero-liability lot exactly nothing, without breaking sum-to-budget", () => {
    // Common-property / non-contributing lot carries weight 0.
    const lots = [
      { lotId: "cp", liability: 0 },
      { lotId: "a", liability: 10 },
      { lotId: "b", liability: 10 },
    ];
    const run = calculateLevyRun([{ fundKind: "admin", annualCents: 1_000_001 }], lots, 4);

    const cpTotal = run.filter((r) => r.lotId === "cp").reduce((a, r) => a + r.totalCents, 0);
    expect(cpTotal).toBe(0);
    // Every cp line is 0 (never NaN/undefined).
    for (const r of run.filter((r) => r.lotId === "cp")) {
      for (const l of r.lines) expect(l.amountCents).toBe(0);
    }
    // The whole budget still lands, distributed across the weighted lots.
    expect(run.reduce((a, r) => a + r.totalCents, 0)).toBe(1_000_001);
  });

  it("produces all-zero lines for a fund not yet levied this period (annualCents 0)", () => {
    const funds = [
      { fundKind: "admin" as const, annualCents: 4_800_000 },
      { fundKind: "maintenance" as const, annualCents: 0 },
    ];
    const lots = [
      { lotId: "a", liability: 10 },
      { lotId: "b", liability: 10 },
    ];
    const run = calculateLevyRun(funds, lots, 4);

    // Every maintenance line is exactly 0.
    const maintenanceLines = run.flatMap((r) => r.lines).filter((l) => l.fundKind === "maintenance");
    expect(maintenanceLines.length).toBeGreaterThan(0);
    for (const l of maintenanceLines) expect(l.amountCents).toBe(0);

    // Grand total equals the sum of both budgets (i.e. just the admin fund).
    const totalBudget = funds.reduce((a, f) => a + f.annualCents, 0);
    expect(run.reduce((a, r) => a + r.totalCents, 0)).toBe(totalBudget);
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

  it("rounds a half-cent tie UP (locks the round-half-up convention)", () => {
    // 5000 × 365 × 1 / (10_000 × 365) = 1,825,000 / 3,650,000 = exactly 0.5.
    // Math.round → 1. Math.floor / Math.trunc → 0; banker's rounding → 0.
    // This case is the only thing that distinguishes the current rule.
    expect(interestAccrued(5000, 365, 1)).toBe(1);
  });

  it("clamps a negative overdueDays to zero (never accrues on a not-yet-due levy)", () => {
    expect(interestAccrued(100_000, 1000, -5)).toBe(0);
    expect(interestAccrued(100_000, 1000, -5, 7)).toBe(0);
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

  it("parks a payment whose reference belongs to a SETTLED notice — even when the amount would match another lot", () => {
    // gs-0100 was paid off; a second payment quoting it with n3's exact
    // outstanding amount must NOT be amount-guessed onto n3.
    expect(
      matchPayment({ payid: "gs-0100", amountCents: 75_000 }, notices, {
        settledPayids: ["gs-0100"],
      }),
    ).toEqual({ kind: "unmatched", reason: "reference matches a settled notice" });
    // …while a genuinely unknown reference still gets the amount heuristic.
    expect(
      matchPayment({ payid: "gs-0100", amountCents: 75_000 }, notices, { settledPayids: [] }),
    ).toMatchObject({ kind: "matched", via: "amount" });
  });

  it("parks a reference that matches MORE THAN ONE open notice (never guesses)", () => {
    // A duplicate PayID across two open notices must never fall through to the
    // amount heuristic and get allocated onto one lot's levy.
    const dupNotices = [
      { levyNoticeId: "n1", payid: "gs-dup", outstandingCents: 40_000 },
      { levyNoticeId: "n2", payid: "gs-dup", outstandingCents: 60_000 },
    ];
    expect(matchPayment({ payid: "gs-dup", amountCents: 60_000 }, dupNotices)).toEqual({
      kind: "unmatched",
      reason: "reference matches multiple notices",
    });
  });

  it("parks an amount that matches MORE THAN ONE open notice", () => {
    // n1 and n2 both outstanding 50,000 — ambiguous, must go to a human.
    expect(matchPayment({ payid: null, amountCents: 50_000 }, notices)).toEqual({
      kind: "unmatched",
      reason: "amount matches multiple notices",
    });
  });

  it("rejects non-positive and non-integer amounts outright", () => {
    expect(matchPayment({ payid: "gs-0002", amountCents: 0 }, notices)).toMatchObject({
      kind: "unmatched",
      reason: "non-positive payment amount",
    });
    expect(matchPayment({ payid: "gs-0002", amountCents: -50_000 }, notices)).toMatchObject({
      kind: "unmatched",
    });
    expect(matchPayment({ payid: "gs-0002", amountCents: Number.NaN }, notices)).toMatchObject({
      kind: "unmatched",
    });
    expect(matchPayment({ payid: "gs-0002", amountCents: 500.5 }, notices)).toMatchObject({
      kind: "unmatched",
    });
  });
});
