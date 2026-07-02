/**
 * Injectable clock. Domain code never calls `new Date()` directly — it takes a
 * Clock so tests, seeds, and the demo can run at a fixed instant.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date | string): Clock {
  const instant = typeof at === "string" ? new Date(at) : at;
  return { now: () => new Date(instant.getTime()) };
}

/** Whole days from `from` to `to`, truncated (negative if `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.trunc(ms / 86_400_000);
}

/** Date-only helper: parse `YYYY-MM-DD` as UTC midnight. */
export function fromDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/** Date-only helper: format a Date as `YYYY-MM-DD` (UTC). */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
