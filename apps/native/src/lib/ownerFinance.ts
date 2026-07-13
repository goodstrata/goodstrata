export interface OwnerObligationSummary {
  /** Sum of each lot's positive balance; credits never hide another lot's debt. */
  amountDueCents: number;
  lotsWithAmountDue: number;
  lotsInCredit: number;
}

/**
 * Summarise personal lot obligations without netting one lot's credit against
 * another lot's amount due.
 */
export function summarizeOwnerObligations(
  balancesCents: readonly number[],
): OwnerObligationSummary {
  return balancesCents.reduce<OwnerObligationSummary>(
    (summary, balanceCents) => ({
      amountDueCents: summary.amountDueCents + Math.max(0, balanceCents),
      lotsWithAmountDue: summary.lotsWithAmountDue + Number(balanceCents > 0),
      lotsInCredit: summary.lotsInCredit + Number(balanceCents < 0),
    }),
    { amountDueCents: 0, lotsWithAmountDue: 0, lotsInCredit: 0 },
  );
}
