/**
 * Formatters for The Registry. All money is integer cents in, formatted
 * string out — never float dollars. Negatives use true minus U+2212.
 */

/** True minus sign (U+2212) — never a hyphen on a figure. */
export const MINUS = "−";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function group(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * `formatMoney(-123456)` → `{ dollars: "−$1,234", cents: ".56" }`.
 * en-AU: `$` prefix, thousands separators, U+2212 for negatives.
 */
export function formatMoney(cents: number): { dollars: string; cents: string } {
  if (__DEV__ && !Number.isInteger(cents)) {
    console.warn(`formatMoney expects integer cents, got ${cents}`);
  }
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  return {
    dollars: `${safe < 0 ? MINUS : ""}$${group(whole)}`,
    cents: `.${String(rem).padStart(2, "0")}`,
  };
}

/** Spoken form for accessibility: "1,234 dollars and 56 cents". */
export function formatMoneyLabel(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const sign = safe < 0 ? "minus " : "";
  const dollars = `${group(whole)} dollar${whole === 1 ? "" : "s"}`;
  if (rem === 0) return `${sign}${dollars}`;
  return `${sign}${dollars} and ${rem} cent${rem === 1 ? "" : "s"}`;
}

/**
 * Raw enum → sentence case: "final_notice" → "Final notice". The one path
 * every pill/eyebrow vocabulary string takes — never `.replace(/_/g, " ")`
 * at a call site.
 */
export function humanise(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/**
 * "PS 543921K · Tier 2" — the registry plate, the signature eyebrow flourish.
 * One implementation: plan of subdivision, then tier digits when known.
 * The eyebrow style uppercases it. Undefined until the scheme resolves —
 * pair with Screen's `reserveEyebrow` so the title never jumps.
 */
export function plate(
  scheme: { planOfSubdivision: string | null; tier?: number | string | null } | undefined,
): string | undefined {
  if (!scheme?.planOfSubdivision) return undefined;
  const tierDigits = scheme.tier == null ? "" : String(scheme.tier).replace(/\D/g, "");
  return tierDigits
    ? `${scheme.planOfSubdivision} · Tier ${tierDigits}`
    : scheme.planOfSubdivision;
}

/** "12 Mar 2026". Empty string for invalid input. */
export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Short relative time for Notifications only: "now", "5 min", "2 h", "3 d";
 * beyond a week it falls back to formatDate.
 */
export function formatRelativeTime(input: string | number | Date, now: number = Date.now()): string {
  const d = input instanceof Date ? input : new Date(input);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} d`;
  return formatDate(d);
}
