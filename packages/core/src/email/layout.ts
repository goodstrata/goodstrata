/**
 * The shared branded email template system for GoodStrata ("The Registry").
 *
 * `renderEmail(input)` turns a structured, content-first input into an
 * email-client-safe `{ html, text }` pair suitable for `OutboundEmail`
 * (the SES provider sends both). Every service and `apps/api` should build
 * transactional mail through this module so the brand, footer, audit-log
 * trust line, and accessibility guarantees stay consistent.
 *
 * Design constraints (why this file looks the way it does):
 *   - Table-based layout with INLINE styles only. Gmail strips <head>/<style>
 *     for many users, and Outlook (Word engine) ignores most modern CSS, so
 *     the visual design must survive with zero stylesheet. The small <style>
 *     block is progressive enhancement for dark mode + mobile only.
 *   - Max width ~600px, centred, on a paper background.
 *   - A masthead on a light panel showing the hosted PNG wordmark (email
 *     clients block SVG and often external images — the PNG has good alt text
 *     and a text "GoodStrata" fallback beside it).
 *   - A bulletproof, eucalypt CTA button (table + padded anchor + MSO VML).
 *   - A hidden plaintext preheader controlling the inbox preview line.
 *   - Web-safe system font stack; bold sans headings.
 */

/** Brand palette, resolved from site/style.css oklch tokens to email-safe hex. */
const COLOR = {
  paper: "#faf9f7",
  card: "#ffffff",
  ink: "#0f1828",
  mutedInk: "#4a5360",
  faintInk: "#6b727c",
  line: "#dce0e5",
  primary: "#095b41", // eucalypt
  primaryStrong: "#004730",
  onPrimary: "#faf9f7",
  accent: "#e9f8f0", // light eucalypt tint
  accentInk: "#03432f",
  critical: "#c52c2a",
} as const;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Canonical hosted URLs. The PNG wordmark is served from the marketing site. */
const URLS = {
  marketing: "https://goodstrata.com.au",
  app: "https://my.goodstrata.com.au",
  logo: "https://goodstrata.com.au/email-logo.png",
  terms: "https://goodstrata.com.au/terms",
  privacy: "https://goodstrata.com.au/privacy",
  /** Placeholder notification-preferences deep link (per-recipient later). */
  preferences: "https://my.goodstrata.com.au/settings/notifications",
} as const;

const ISSUER = "Good Strata Pty Ltd";
const ACN = "ACN 684 135 760";
const TRUST_LINE = "Every action on GoodStrata is recorded on an append-only audit log.";

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

/** A CTA or link target: human label + absolute URL. */
export interface EmailLink {
  label: string;
  url: string;
}

/** A short paragraph of body copy. */
export interface ParagraphBlock {
  kind: "paragraph";
  text: string;
}

/** A label/value detail table (e.g. levy notice number, due date, lot). */
export interface KeyValueTableBlock {
  kind: "keyValueTable";
  rows: { label: string; value: string }[];
  /** Optional caption shown above the table (e.g. "Notice details"). */
  caption?: string;
}

/** A prominent money/figure panel (e.g. an amount due). */
export interface AmountPanelBlock {
  kind: "amountPanel";
  /** Small label above the figure, e.g. "Total due". */
  label: string;
  /** The pre-formatted figure, e.g. "$8,400.00". */
  amount: string;
  /** Optional line under the figure, e.g. "Due 14 July 2026". */
  sublabel?: string;
  /** `critical` tints the figure oxide-red (overdue/arrears). */
  tone?: "default" | "critical";
}

/** A bordered callout note (context, caveats, reassurance). */
export interface InfoNoteBlock {
  kind: "infoNote";
  text: string;
  /** `warning` uses the oxide-red accent; `info` (default) uses eucalypt. */
  tone?: "info" | "warning";
}

export type EmailBlock = ParagraphBlock | KeyValueTableBlock | AmountPanelBlock | InfoNoteBlock;

/** Structured, presentation-agnostic description of a transactional email. */
export interface EmailInput {
  /** Inbox preview line (hidden in the body). Keep ~40–120 chars. */
  preheader: string;
  /** The email's H1. */
  heading: string;
  /** Optional lead paragraph directly under the heading. */
  intro?: string;
  /** Ordered body blocks. */
  blocks?: EmailBlock[];
  /** Primary call to action, rendered as the eucalypt button. */
  cta?: EmailLink;
  /** Secondary text links shown under the CTA. */
  secondaryLinks?: EmailLink[];
  /** Optional fine-print line above the standard footer. */
  footerNote?: string;
  /**
   * Override the "manage notifications" link (defaults to the app settings
   * placeholder). Supply a per-recipient preferences URL when available.
   */
  preferencesUrl?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Block helper constructors (ergonomic call sites for services + apps/api)
// ---------------------------------------------------------------------------

export const paragraph = (text: string): ParagraphBlock => ({ kind: "paragraph", text });

export const keyValueTable = (
  rows: { label: string; value: string }[],
  caption?: string,
): KeyValueTableBlock => ({ kind: "keyValueTable", rows, caption });

export const amountPanel = (
  label: string,
  amount: string,
  opts?: { sublabel?: string; tone?: "default" | "critical" },
): AmountPanelBlock => ({
  kind: "amountPanel",
  label,
  amount,
  sublabel: opts?.sublabel,
  tone: opts?.tone,
});

export const infoNote = (text: string, tone: "info" | "warning" = "info"): InfoNoteBlock => ({
  kind: "infoNote",
  text,
  tone,
});

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a URL for use in an href/src attribute (quotes + angle brackets). */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// HTML block renderers
// ---------------------------------------------------------------------------

function renderParagraph(b: ParagraphBlock): string {
  return `<tr><td style="padding:0 0 16px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${COLOR.ink};">${escapeHtml(
    b.text,
  )}</td></tr>`;
}

function renderKeyValueTable(b: KeyValueTableBlock): string {
  const caption = b.caption
    ? `<div style="font-family:${FONT_STACK};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${COLOR.faintInk};padding:0 0 8px 2px;">${escapeHtml(
        b.caption,
      )}</div>`
    : "";
  const rows = b.rows
    .map((r, i) => {
      const border = i === 0 ? "" : `border-top:1px solid ${COLOR.line};`;
      return `<tr>
        <td style="${border}padding:10px 14px;font-family:${FONT_STACK};font-size:14px;color:${COLOR.mutedInk};vertical-align:top;">${escapeHtml(
          r.label,
        )}</td>
        <td style="${border}padding:10px 14px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${COLOR.ink};text-align:right;vertical-align:top;">${escapeHtml(
          r.value,
        )}</td>
      </tr>`;
    })
    .join("");
  return `<tr><td style="padding:0 0 20px 0;">${caption}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLOR.line};border-radius:10px;border-collapse:separate;overflow:hidden;background:${COLOR.card};">${rows}</table></td></tr>`;
}

function renderAmountPanel(b: AmountPanelBlock): string {
  const figureColor = b.tone === "critical" ? COLOR.critical : COLOR.primary;
  const sub = b.sublabel
    ? `<div style="font-family:${FONT_STACK};font-size:13px;color:${COLOR.mutedInk};padding-top:6px;">${escapeHtml(
        b.sublabel,
      )}</div>`
    : "";
  return `<tr><td style="padding:0 0 20px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.accent};border:1px solid ${COLOR.line};border-left:3px solid ${figureColor};border-radius:10px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-family:${FONT_STACK};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${COLOR.accentInk};">${escapeHtml(
          b.label,
        )}</div>
        <div style="font-family:${FONT_STACK};font-size:30px;font-weight:700;line-height:1.1;color:${figureColor};padding-top:4px;">${escapeHtml(
          b.amount,
        )}</div>
        ${sub}
      </td></tr>
    </table>
  </td></tr>`;
}

function renderInfoNote(b: InfoNoteBlock): string {
  const edge = b.tone === "warning" ? COLOR.critical : COLOR.primary;
  return `<tr><td style="padding:0 0 20px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.card};border:1px solid ${COLOR.line};border-left:3px solid ${edge};border-radius:10px;">
      <tr><td style="padding:14px 18px;font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${COLOR.mutedInk};">${escapeHtml(
        b.text,
      )}</td></tr>
    </table>
  </td></tr>`;
}

function renderBlock(b: EmailBlock): string {
  switch (b.kind) {
    case "paragraph":
      return renderParagraph(b);
    case "keyValueTable":
      return renderKeyValueTable(b);
    case "amountPanel":
      return renderAmountPanel(b);
    case "infoNote":
      return renderInfoNote(b);
  }
}

/** Bulletproof eucalypt CTA button: MSO VML for Outlook + padded anchor. */
function renderButton(cta: EmailLink): string {
  const href = escapeAttr(cta.url);
  const label = escapeHtml(cta.label);
  return `<tr><td style="padding:6px 0 22px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="${COLOR.primary}" style="border-radius:8px;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="17%" strokecolor="${COLOR.primary}" fillcolor="${COLOR.primary}"><w:anchorlock/><center style="color:${COLOR.onPrimary};font-family:${FONT_STACK};font-size:16px;font-weight:700;">${label}</center></v:roundrect><![endif]-->
        <!--[if !mso]><!-- --><a href="${href}" style="display:inline-block;padding:13px 30px;font-family:${FONT_STACK};font-size:16px;font-weight:700;color:${COLOR.onPrimary};text-decoration:none;border-radius:8px;background:${COLOR.primary};">${label}</a><!--<![endif]-->
      </td></tr>
    </table>
  </td></tr>`;
}

function renderSecondaryLinks(links: EmailLink[]): string {
  if (links.length === 0) return "";
  const items = links
    .map(
      (l) =>
        `<a href="${escapeAttr(l.url)}" style="color:${COLOR.primary};text-decoration:underline;font-weight:600;">${escapeHtml(
          l.label,
        )}</a>`,
    )
    .join(`<span style="color:${COLOR.line};">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);
  return `<tr><td style="padding:0 0 22px 0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${COLOR.mutedInk};">${items}</td></tr>`;
}

// ---------------------------------------------------------------------------
// renderEmail
// ---------------------------------------------------------------------------

export function renderEmail(input: EmailInput): RenderedEmail {
  return { html: renderHtml(input), text: renderText(input) };
}

function renderHtml(input: EmailInput): string {
  const prefsUrl = input.preferencesUrl ?? URLS.preferences;

  const intro = input.intro
    ? `<tr><td style="padding:0 0 18px 0;font-family:${FONT_STACK};font-size:17px;line-height:1.6;color:${COLOR.mutedInk};">${escapeHtml(
        input.intro,
      )}</td></tr>`
    : "";

  const blocks = (input.blocks ?? []).map(renderBlock).join("");
  const cta = input.cta ? renderButton(input.cta) : "";
  const secondary = input.secondaryLinks ? renderSecondaryLinks(input.secondaryLinks) : "";
  const footerNote = input.footerNote
    ? `<tr><td style="padding:0 0 14px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.55;color:${COLOR.faintInk};">${escapeHtml(
        input.footerNote,
      )}</td></tr>`
    : "";

  // A run of zero-width joiners after the preheader stops clients pulling the
  // body's first words into the inbox preview.
  const preheaderPad = "‌ ".repeat(80);

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(input.heading)}</title>
<!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${COLOR.primary}; }
  @media only screen and (max-width:600px) {
    .gs-container { width:100% !important; }
    .gs-pad { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body class="gs-body" style="margin:0;padding:0;background:${COLOR.paper};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.paper};">${escapeHtml(
    input.preheader,
  )}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="gs-body" style="background:${COLOR.paper};">
  <tr><td align="center" style="padding:24px 12px 40px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="gs-container" style="width:600px;max-width:600px;">

      <!-- masthead -->
      <tr><td style="padding:8px 8px 20px 8px;">
        <a href="${escapeAttr(URLS.marketing)}" style="text-decoration:none;">
          <img src="${escapeAttr(URLS.logo)}" width="200" height="42" alt="GoodStrata" style="display:block;width:200px;max-width:200px;height:auto;border:0;">
        </a>
      </td></tr>

      <!-- card -->
      <tr><td class="gs-card" style="background:${COLOR.card};border:1px solid ${COLOR.line};border-radius:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="gs-pad" style="padding:32px 34px 10px 34px;">
            <h1 class="gs-ink" style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${COLOR.ink};">${escapeHtml(
              input.heading,
            )}</h1>
          </td></tr>
          <tr><td class="gs-pad" style="padding:0 34px 0 34px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${intro}
              ${blocks}
              ${cta}
              ${secondary}
            </table>
          </td></tr>
          <tr><td class="gs-pad" style="padding:4px 34px 30px 34px;"></td></tr>
        </table>
      </td></tr>

      <!-- footer -->
      <tr><td class="gs-pad" style="padding:26px 20px 8px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${footerNote}
          <tr><td style="padding:0 0 14px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${COLOR.faintInk};" class="gs-footer">${escapeHtml(
            TRUST_LINE,
          )}</td></tr>
          <tr><td style="border-top:1px solid ${COLOR.line};padding:14px 0 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLOR.faintInk};" class="gs-footer">
            <strong style="color:${COLOR.mutedInk};">${escapeHtml(ISSUER)}</strong> &middot; ${escapeHtml(
              ACN,
            )}<br>
            <a href="${escapeAttr(URLS.marketing)}" style="color:${COLOR.faintInk};text-decoration:underline;">goodstrata.com.au</a>
            &nbsp;&middot;&nbsp;
            <a href="${escapeAttr(URLS.terms)}" style="color:${COLOR.faintInk};text-decoration:underline;">Terms</a>
            &nbsp;&middot;&nbsp;
            <a href="${escapeAttr(URLS.privacy)}" style="color:${COLOR.faintInk};text-decoration:underline;">Privacy</a>
            &nbsp;&middot;&nbsp;
            <a href="${escapeAttr(prefsUrl)}" style="color:${COLOR.faintInk};text-decoration:underline;">Manage notifications</a>
          </td></tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plaintext renderer — accessible, links inline, mirrors the HTML content.
// ---------------------------------------------------------------------------

function textBlock(b: EmailBlock): string {
  switch (b.kind) {
    case "paragraph":
      return b.text;
    case "keyValueTable": {
      const head = b.caption ? `${b.caption.toUpperCase()}\n` : "";
      return head + b.rows.map((r) => `  ${r.label}: ${r.value}`).join("\n");
    }
    case "amountPanel": {
      const sub = b.sublabel ? `\n  ${b.sublabel}` : "";
      return `${b.label.toUpperCase()}\n  ${b.amount}${sub}`;
    }
    case "infoNote":
      return `Note: ${b.text}`;
  }
}

function renderText(input: EmailInput): string {
  const prefsUrl = input.preferencesUrl ?? URLS.preferences;
  const parts: string[] = [];

  parts.push(input.heading);
  if (input.intro) parts.push(input.intro);

  for (const b of input.blocks ?? []) parts.push(textBlock(b));

  if (input.cta) parts.push(`${input.cta.label}: ${input.cta.url}`);

  if (input.secondaryLinks && input.secondaryLinks.length > 0) {
    parts.push(input.secondaryLinks.map((l) => `${l.label}: ${l.url}`).join("\n"));
  }

  if (input.footerNote) parts.push(input.footerNote);

  parts.push(TRUST_LINE);

  parts.push(
    [
      `${ISSUER} · ${ACN}`,
      `Web: ${URLS.marketing}`,
      `Terms: ${URLS.terms}`,
      `Privacy: ${URLS.privacy}`,
      `Manage notifications: ${prefsUrl}`,
    ].join("\n"),
  );

  // Single blank line between logical sections; trailing newline for archives.
  return `${parts.join("\n\n")}\n`;
}

/** Exposed for tests and callers needing the canonical asset/brand URLs. */
export const emailBrand = {
  colors: COLOR,
  urls: URLS,
  issuer: ISSUER,
  acn: ACN,
  trustLine: TRUST_LINE,
  fontStack: FONT_STACK,
} as const;
