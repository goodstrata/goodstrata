// The Registry design tokens, ported verbatim from site/style.css.
// Both light and the deep-eucalypt "by the numbers" band are here; the
// homepage muted cut renders on the LIGHT theme (the site's default).

export type Theme = {
  paper: string;
  card: string;
  ink: string;
  mutedInk: string;
  faintInk: string;
  line: string;
  primary: string;
  primaryStrong: string;
  onPrimary: string;
  accent: string;
  accentInk: string;
  critical: string;
  // deep-eucalypt proof band
  bandBg: string;
  bandInk: string;
  bandMuted: string;
  bandFig: string;
  bandLine: string;
};

export const light: Theme = {
  paper: "oklch(0.982 0.003 95)",
  card: "oklch(1 0 0)",
  ink: "oklch(0.21 0.035 260)",
  mutedInk: "oklch(0.44 0.024 258)",
  faintInk: "oklch(0.55 0.018 256)",
  line: "oklch(0.905 0.008 250)",
  primary: "oklch(0.42 0.085 165)",
  primaryStrong: "oklch(0.35 0.08 165)",
  onPrimary: "oklch(0.982 0.003 95)",
  accent: "oklch(0.965 0.018 165)",
  accentInk: "oklch(0.34 0.07 165)",
  critical: "oklch(0.54 0.19 27)",
  bandBg: "oklch(0.3 0.052 165)",
  bandInk: "oklch(0.965 0.012 165)",
  bandMuted: "oklch(0.83 0.03 165)",
  bandFig: "oklch(0.87 0.115 165)",
  bandLine: "oklch(0.46 0.05 165)",
};

export const dark: Theme = {
  paper: "oklch(0.175 0.015 255)",
  card: "oklch(0.215 0.018 255)",
  ink: "oklch(0.93 0.006 250)",
  mutedInk: "oklch(0.74 0.016 252)",
  faintInk: "oklch(0.64 0.015 252)",
  line: "oklch(0.31 0.02 255)",
  primary: "oklch(0.78 0.09 165)",
  primaryStrong: "oklch(0.85 0.09 165)",
  onPrimary: "oklch(0.18 0.03 260)",
  accent: "oklch(0.28 0.03 170)",
  accentInk: "oklch(0.85 0.07 165)",
  critical: "oklch(0.68 0.16 27)",
  bandBg: "oklch(0.235 0.038 165)",
  bandInk: "oklch(0.95 0.012 165)",
  bandMuted: "oklch(0.79 0.03 165)",
  bandFig: "oklch(0.85 0.115 165)",
  bandLine: "oklch(0.38 0.045 165)",
};

// Typography — the same self-hosted families the site preloads.
export const fonts = {
  sans: '"Public Sans Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  serif: '"Newsreader Variable", Georgia, serif',
};

// ---------------------------------------------------------------------------
// Fee arithmetic — MUST agree with the live homepage slider
// (site/index.html: lots*550 mgmt, *110 admin, *40 meetings, *700 total).
// ---------------------------------------------------------------------------
export const LOTS = 12;
export const PER_LOT_MGMT = 550;
export const PER_LOT_ADMIN = 110;
export const PER_LOT_MEET = 40;
export const PER_LOT_TOTAL = 700;

export const fees = {
  lots: LOTS,
  base: LOTS * PER_LOT_MGMT, // $6,600
  disbursements: LOTS * PER_LOT_ADMIN, // $1,320
  meetings: LOTS * PER_LOT_MEET, // $480
  total: LOTS * PER_LOT_TOTAL, // $8,400
};

// en-AU dollar formatting, matching the slider's money() helper exactly.
export const money = (n: number): string => `$${Math.round(n).toLocaleString("en-AU")}`;
