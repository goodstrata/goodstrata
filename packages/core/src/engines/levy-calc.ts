import { allocateByWeight, type Cents } from "@goodstrata/shared";

/**
 * Levy apportionment (Vic OC Act s 23: levies are set in proportion to lot
 * liability). Pure function — no I/O, exhaustively unit-tested.
 *
 * Two-stage largest-remainder allocation guarantees:
 *  - the annual amounts across lots sum exactly to the fund budget;
 *  - each lot's instalments sum exactly to its annual amount.
 */

export interface LotLiability {
  lotId: string;
  liability: number;
}

export interface FundBudget {
  fundKind: "admin" | "maintenance";
  annualCents: Cents;
}

export interface LevyLine {
  fundKind: "admin" | "maintenance";
  amountCents: Cents;
}

export interface LotInstalment {
  lotId: string;
  instalment: number; // 1-based
  lines: LevyLine[];
  totalCents: Cents;
}

export function calculateLevyRun(
  funds: FundBudget[],
  lots: LotLiability[],
  instalments: number,
): LotInstalment[] {
  if (lots.length === 0) throw new Error("levy-calc: no lots");
  if (instalments < 1 || !Number.isInteger(instalments)) {
    throw new Error("levy-calc: instalments must be a positive integer");
  }

  const weights = lots.map((l) => l.liability);

  // fund → per-lot annual → per-lot instalment amounts
  const perFundPerLotPerInstalment = funds.map((fund) => {
    const annualPerLot = allocateByWeight(fund.annualCents, weights);
    const instalmentSplit = annualPerLot.map((annual) =>
      allocateByWeight(annual, Array(instalments).fill(1)),
    );
    return { fund, instalmentSplit };
  });

  const result: LotInstalment[] = [];
  for (let i = 0; i < instalments; i++) {
    lots.forEach((lot, lotIdx) => {
      const lines: LevyLine[] = perFundPerLotPerInstalment.map(({ fund, instalmentSplit }) => ({
        fundKind: fund.fundKind,
        amountCents: instalmentSplit[lotIdx]![i]!,
      }));
      result.push({
        lotId: lot.lotId,
        instalment: i + 1,
        lines,
        totalCents: lines.reduce((a, l) => a + l.amountCents, 0),
      });
    });
  }
  return result;
}
