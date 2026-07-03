/**
 * Brand tokens + page geometry for the transactional PDF system, mirroring
 * site/style.css (The Registry). oklch tokens are pre-converted to sRGB hex so
 * the renderer stays dependency-free. Eucalypt green on ink/paper.
 */

export const color = {
  paper: "#faf9f7",
  ink: "#0f1828",
  mutedInk: "#4a5360",
  line: "#dce0e5",
  primary: "#095b41",
  primaryStrong: "#004730",
  primaryDark: "#003924",
  accent: "#e9f8f0",
  accentInk: "#03432f",
  white: "#ffffff",
} as const;

/** A4 in PostScript points (1pt = 1/72"). */
export const page = {
  width: 595.28,
  height: 841.89,
  margin: 48,
} as const;

export const contentWidth = page.width - page.margin * 2;

export const font = {
  sans: "PublicSans",
  sansSemibold: "PublicSans-SemiBold",
  sansBold: "PublicSans-Bold",
  mono: "IBMPlexMono",
  monoMedium: "IBMPlexMono-Medium",
} as const;

export const LEGAL_ISSUER = "Good Strata Pty Ltd";
export const LEGAL_ACN = "ACN 684 135 760";
export const LEGAL_DOMAIN = "goodstrata.com.au";
export const AUDIT_LINE = "Every line on this document ties to the append-only audit log.";

const FUND_LABELS: Record<string, string> = {
  admin: "Administration fund",
  maintenance: "Maintenance (capital works) fund",
  sinking: "Maintenance (capital works) fund",
  interest: "Interest on overdue amounts",
};

export function fundLabel(kind: string): string {
  return FUND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Format integer cents as AUD — a local mirror of @goodstrata/shared's
 * formatCents so the PDF module carries no workspace coupling.
 */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-AU")}.${remainder.toString().padStart(2, "0")}`;
}

/** GST component of a GST-inclusive amount (Australia, 10%). */
export function gstOf(inclusiveCents: number): number {
  return Math.round(inclusiveCents / 11);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** yyyy-mm-dd (or Date) → "3 July 2026", timezone-stable for date-only values. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  let y: number;
  let m: number;
  let d: number;
  if (value instanceof Date) {
    y = value.getUTCFullYear();
    m = value.getUTCMonth();
    d = value.getUTCDate();
  } else {
    const iso = value.slice(0, 10);
    const parts = iso.split("-");
    if (parts.length !== 3) return value;
    y = Number(parts[0]);
    m = Number(parts[1]) - 1;
    d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return value;
  }
  const month = MONTHS[m] ?? "";
  return `${d} ${month} ${y}`;
}
