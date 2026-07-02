import type { Cents } from "@goodstrata/shared";

/**
 * Penalty interest on overdue levies (OC Act s 29: simple interest at the
 * rate fixed under the Penalty Interest Rates Act, unless the OC resolves a
 * lower rate). Simple (non-compounding) daily interest, actual/365 basis —
 * including in leap years, per Australian convention for penalty interest.
 */
export function interestAccrued(
  principalCents: Cents,
  annualRateBps: number,
  overdueDays: number,
  graceDays = 0,
): Cents {
  if (principalCents <= 0 || annualRateBps <= 0) return 0;
  const chargeableDays = Math.max(0, overdueDays - graceDays);
  if (chargeableDays === 0) return 0;
  return Math.round((principalCents * annualRateBps * chargeableDays) / (10_000 * 365));
}
