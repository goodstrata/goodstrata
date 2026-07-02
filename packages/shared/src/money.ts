/**
 * All money in GoodStrata is integer cents (AUD), carried as `number` in JS
 * (safe far beyond any OC's budget) and `bigint` columns in Postgres.
 * These helpers are the ONLY place rounding rules live.
 */

export type Cents = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money must be integer cents, got ${value}`);
  }
  return value;
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-AU")}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * Split `total` cents proportionally to `weights` using the largest-remainder
 * method: shares always sum exactly to `total`, and equal weights differ by
 * at most one cent. Order of the input is preserved in the output.
 *
 * This is the engine behind levy apportionment (unit liability weighting).
 */
export function allocateByWeight(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new Error("allocateByWeight: no weights");
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error("allocateByWeight: weights must be non-negative finite numbers");
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new Error("allocateByWeight: weight sum must be positive");

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((e) => Math.floor(e));
  let shortfall = total - floors.reduce((a, b) => a + b, 0);

  // Distribute leftover cents to the largest fractional remainders,
  // breaking ties by earlier index (stable, deterministic).
  const byRemainder = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (const { i } of byRemainder) {
    if (shortfall <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    shortfall -= 1;
  }
  return result;
}

/** GST at 10%, rounded half-up per ATO convention, from a GST-exclusive amount. */
export function gstFromExclusive(exclusiveCents: Cents): Cents {
  assertCents(exclusiveCents);
  return Math.round(exclusiveCents / 10);
}

/** Extract the GST component of a GST-inclusive amount (1/11th, rounded half-up). */
export function gstFromInclusive(inclusiveCents: Cents): Cents {
  assertCents(inclusiveCents);
  return Math.round(inclusiveCents / 11);
}
