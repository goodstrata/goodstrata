import { createHash } from "node:crypto";
import type { EmailProvider } from "./email.js";

/**
 * Trade-market abstraction: how an RFQ (request for quotes) leaves the
 * platform and how quotes come back, normalized. The scheme's own contractor
 * book is a first-class provider; invited-email and marketplace drivers are
 * plugins behind the same interface — the platform stays agnostic by
 * architecture.
 */

/**
 * Anonymized by construction: this struct IS the outbound payload. No owner
 * names/emails/phones, no lot numbers, no street address exists on it — the
 * exact address is revealed only post-award via the work-order dispatch.
 */
export interface RfqPosting {
  rfqId: string;
  title: string;
  /** Scope of works (markdown) — the only prose that leaves the platform. */
  scopeMd: string;
  category: string;
  /** Suburb-level location is ALL external parties get pre-award. */
  suburb: string;
  buildingType: string | null;
  /** ISO date quotes are due by, when set. */
  quotesDueOn: string | null;
  /** Where replies route (provider-specific: reply-to address or webhook token). */
  replyRef: string;
}

/** A direct send target — a scheme-book contractor or an invited email address. */
export interface RfqRecipient {
  email: string;
  businessName?: string | null;
  contactName?: string | null;
  /**
   * Per-recipient self-service quote token (the `rfqChannels.quoteToken` for
   * THIS recipient's channel), minted at dispatch. The RFQ email renders it as
   * an "Add your quote →" button to `${APP_URL}/quote/${quoteToken}`. Absent on
   * broadcast providers, which have no per-recipient channel.
   */
  quoteToken?: string | null;
}

/**
 * A quote normalized from any provider. Marketplace fees MUST arrive here —
 * a driver that can't report its fees can't exist (zero hidden margin).
 */
export interface NormalizedQuote {
  /** Provider's unique id for this quote — idempotency key. */
  providerRef: string;
  rfqId: string;
  amountCents: number;
  businessName: string;
  abn: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** ISO date the quote is valid until, when stated. */
  validUntil: string | null;
  notes: string | null;
  /** Respondent attests a current trade licence for the category. */
  licenceConfirmed: boolean;
  /** Respondent attests current public-liability insurance. */
  insuranceConfirmed: boolean;
  platformFeeCents: number;
  referralFeeCents: number;
  /** Required whenever either fee is nonzero. */
  feeRecipient: string | null;
  raw: unknown;
}

export interface TradeMarketCapabilities {
  /** true → postJob needs explicit `recipients` (scheme book / invited emails). */
  requiresRecipients: boolean;
  /** true → the provider can be polled for quotes via fetchQuotes. */
  canFetchQuotes: boolean;
  /** true → quotes arrive by signed webhook (marketplace phase). */
  supportsWebhooks: boolean;
}

export interface TradeMarketProvider {
  readonly name: string;
  /**
   * Post the anonymized job. `recipients` addresses direct sends; broadcast
   * providers ignore it. Returns the provider's handle for the posting
   * (idempotency / withdraw / fetch key).
   */
  postJob(input: {
    posting: RfqPosting;
    recipients?: RfqRecipient[];
  }): Promise<{ externalRef: string }>;
  /** Poll for quotes on a posting. Providers without polling return []. */
  fetchQuotes(externalRef: string): Promise<NormalizedQuote[]>;
  capabilities(): TradeMarketCapabilities;
  // Marketplace webhook half — optional, mirrors PaymentsProvider.
  readonly signatureHeader?: string;
  verifyWebhook?(rawBody: string, signature: string | undefined): boolean;
  parseWebhook?(rawBody: string): NormalizedQuote;
}

/**
 * Deterministic posting handle: stable across retries so a re-post of the
 * same RFQ to the same recipients never forks a second external identity.
 */
function postingRef(prefix: string, posting: RfqPosting, recipients: RfqRecipient[]): string {
  const digest = createHash("sha256")
    .update(posting.rfqId)
    .update("\n")
    .update(
      recipients
        .map((r) => r.email.toLowerCase())
        .sort()
        .join(","),
    )
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${posting.rfqId}-${digest}`;
}

/** Per-recipient render options for {@link renderRfqEmail}. */
export interface RenderRfqEmailOptions {
  /** Subject-line reply token (email_rfq); routes an inbound reply to the RFQ. */
  trackingToken?: string;
  /**
   * The recipient's self-service quote page URL (`${APP_URL}/quote/${token}`).
   * When present, the email leads with an "Add your quote →" button and drops
   * the "reply referencing" instruction; when absent (broadcast, no per-recipient
   * channel), the reply-ref fallback is kept.
   */
  quoteUrl?: string;
}

// ---------------------------------------------------------------------------
// Self-contained email HTML + safe markdown.
//
// `packages/integrations` sits BELOW `@goodstrata/core` in the dependency graph,
// so it cannot import core's `renderEmail` / `renderMarkdown`. This is a
// deliberately minimal, self-contained copy: escape-first markdown (never emits
// unescaped user HTML) plus a small table-based, inline-styled shell with a
// bulletproof CTA button. The scope prose is the only untrusted input and it is
// escaped before any tag is applied.
// ---------------------------------------------------------------------------

const RFQ_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const RFQ_EUCALYPT = "#095b41";
const RFQ_PAPER = "#faf9f7";
const RFQ_INK = "#0f1828";
const RFQ_MUTED = "#4a5360";
const RFQ_LINE = "#dce0e5";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a URL for an href attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inline `**bold**` on an already-escaped run — no other inline markup. */
function inlineMd(run: string): string {
  return escapeHtml(run).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Minimal, safe markdown → HTML for the scope prose. Escapes every run FIRST,
 * then applies a fixed whitelist (`<h3>`, `<ul><li>`, `<p>`, `<strong>`). No
 * links, images, or raw HTML pass through — a `<script>` becomes escaped text.
 * Mirrors core's `renderMarkdown` (kept in sync; integrations can't import it).
 */
function renderScopeHtml(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let items: string[] = [];
  const flushPara = () => {
    if (para.length) html.push(`<p style="margin:0 0 12px 0;">${inlineMd(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (items.length)
      html.push(
        `<ul style="margin:0 0 12px 0;padding-left:22px;">${items
          .map((i) => `<li style="margin:0 0 4px 0;">${inlineMd(i)}</li>`)
          .join("")}</ul>`,
      );
    items = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      html.push(
        `<h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:${RFQ_INK};">${inlineMd(
          heading[2]!,
        )}</h3>`,
      );
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      items.push(item[1]!);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();
  return html.join("");
}

/** Bulletproof eucalypt CTA button (MSO VML + padded anchor). */
function rfqButton(label: string, url: string): string {
  const href = escapeAttr(url);
  const text = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">
    <tr><td align="center" bgcolor="${RFQ_EUCALYPT}" style="border-radius:8px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="17%" strokecolor="${RFQ_EUCALYPT}" fillcolor="${RFQ_EUCALYPT}"><w:anchorlock/><center style="color:${RFQ_PAPER};font-family:${RFQ_FONT_STACK};font-size:16px;font-weight:700;">${text}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!-- --><a href="${href}" style="display:inline-block;padding:13px 30px;font-family:${RFQ_FONT_STACK};font-size:16px;font-weight:700;color:${RFQ_PAPER};text-decoration:none;border-radius:8px;background:${RFQ_EUCALYPT};">${text}</a><!--<![endif]-->
    </td></tr>
  </table>`;
}

function renderRfqEmailHtml(
  posting: RfqPosting,
  opts: RenderRfqEmailOptions,
  subject: string,
): string {
  const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;font-family:${RFQ_FONT_STACK};font-size:14px;color:${RFQ_MUTED};">${escapeHtml(
      label,
    )}</td><td style="padding:6px 0;font-family:${RFQ_FONT_STACK};font-size:14px;font-weight:600;color:${RFQ_INK};text-align:right;">${escapeHtml(
      value,
    )}</td></tr>`;
  const details = [
    detailRow("Trade category", posting.category),
    ...(posting.buildingType ? [detailRow("Building type", posting.buildingType)] : []),
    ...(posting.quotesDueOn ? [detailRow("Quotes due by", posting.quotesDueOn)] : []),
    detailRow("Location", posting.suburb),
  ].join("");
  const action = opts.quoteUrl
    ? rfqButton("Add your quote →", opts.quoteUrl)
    : `<p style="font-family:${RFQ_FONT_STACK};font-size:15px;color:${RFQ_INK};margin:8px 0 20px 0;">To quote, reply to this email referencing <strong>${escapeHtml(
        posting.replyRef,
      )}</strong>.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    subject,
  )}</title></head>
<body style="margin:0;padding:0;background:${RFQ_PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${RFQ_PAPER};">
  <tr><td align="center" style="padding:24px 12px 40px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${RFQ_LINE};border-radius:16px;">
      <tr><td style="padding:30px 34px;">
        <h1 style="margin:0 0 14px 0;font-family:${RFQ_FONT_STACK};font-size:22px;font-weight:700;color:${RFQ_INK};">Quote requested: ${escapeHtml(
          posting.title,
        )}</h1>
        <p style="margin:0 0 18px 0;font-family:${RFQ_FONT_STACK};font-size:16px;line-height:1.6;color:${RFQ_MUTED};">A body corporate in ${escapeHtml(
          posting.suburb,
        )} is requesting quotes for the following job.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RFQ_LINE};border-radius:10px;padding:4px 14px;margin:0 0 18px 0;">${details}</table>
        <div style="font-family:${RFQ_FONT_STACK};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6b727c;padding:0 0 8px 2px;">Scope of works</div>
        <div style="font-family:${RFQ_FONT_STACK};font-size:15px;line-height:1.6;color:${RFQ_INK};">${renderScopeHtml(
          posting.scopeMd,
        )}</div>
        ${action}
        <p style="margin:8px 0 0 0;font-family:${RFQ_FONT_STACK};font-size:13px;line-height:1.55;color:#6b727c;">The exact property address is shared with the successful contractor once the committee awards the job.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Render the outbound RFQ email from the posting plus per-recipient options.
 * Taking `RfqPosting` as the only job-data argument is the anonymization
 * guarantee: address, lot and person fields don't exist on it, so they cannot
 * leak into the body. `opts` carries only the recipient's own tokens/URL.
 */
export function renderRfqEmail(
  posting: RfqPosting,
  opts: RenderRfqEmailOptions = {},
): { subject: string; text: string; html: string } {
  const subject = opts.trackingToken
    ? `[GS-RFQ ${opts.trackingToken}] Quote requested: ${posting.title}`
    : `Quote requested: ${posting.title}`;
  const action = opts.quoteUrl
    ? ["Add your quote here:", opts.quoteUrl]
    : [`To quote, reply referencing: ${posting.replyRef}`];
  const lines = [
    `A body corporate in ${posting.suburb} is requesting quotes for the following job.`,
    "",
    `Trade category: ${posting.category}`,
    ...(posting.buildingType ? [`Building type: ${posting.buildingType}`] : []),
    ...(posting.quotesDueOn ? [`Quotes due by: ${posting.quotesDueOn}`] : []),
    "",
    "Scope of works:",
    posting.scopeMd,
    "",
    ...action,
    "",
    "The exact property address is shared with the successful contractor once the committee awards the job.",
  ];
  return { subject, text: lines.join("\n"), html: renderRfqEmailHtml(posting, opts, subject) };
}

/** Build a recipient's quote-page URL from the shared app base + their token. */
function quoteUrlFor(appUrl: string, recipient: RfqRecipient): string | undefined {
  return recipient.quoteToken ? `${appUrl}/quote/${recipient.quoteToken}` : undefined;
}

/**
 * The scheme's own contractor book as a first-class trade market: the RFQ is
 * emailed to the scheme's registered contractors via the injected
 * EmailProvider. Quotes come back out-of-band (reply → officer records them),
 * so fetchQuotes is empty by design. No fees exist on this channel.
 */
export function schemeBookTradeMarketProvider(
  email: EmailProvider,
  appUrl = "https://my.goodstrata.com.au",
): TradeMarketProvider {
  return {
    name: "scheme_book",
    capabilities() {
      return { requiresRecipients: true, canFetchQuotes: false, supportsWebhooks: false };
    },
    async postJob({ posting, recipients }) {
      if (!recipients || recipients.length === 0) {
        throw new Error("trade-market: scheme_book postJob requires at least one recipient");
      }
      // Rendered per recipient: the "Add your quote →" button carries THIS
      // contractor's own quote token, so no link is shared across recipients.
      for (const recipient of recipients) {
        const { subject, text, html } = renderRfqEmail(posting, {
          quoteUrl: quoteUrlFor(appUrl, recipient),
        });
        await email.send({ to: recipient.email, subject, text, html });
      }
      return { externalRef: postingRef("scheme-book", posting, recipients) };
    },
    async fetchQuotes() {
      return [];
    },
  };
}

/**
 * RFQ to arbitrary invited email addresses (tradies not yet in any book).
 * The subject carries a reply-to tracking token derived from the posting so
 * inbound replies can be routed back to the RFQ.
 */
export function emailRfqTradeMarketProvider(
  email: EmailProvider,
  appUrl = "https://my.goodstrata.com.au",
): TradeMarketProvider {
  return {
    name: "email_rfq",
    capabilities() {
      return { requiresRecipients: true, canFetchQuotes: false, supportsWebhooks: false };
    },
    async postJob({ posting, recipients }) {
      if (!recipients || recipients.length === 0) {
        throw new Error("trade-market: email_rfq postJob requires at least one invited email");
      }
      const externalRef = postingRef("email-rfq", posting, recipients);
      // The tracking token IS the external ref (subject line) so an inbound
      // reply still resolves back to the posting; the quote button carries the
      // recipient's own per-channel token for the self-service page.
      for (const recipient of recipients) {
        const { subject, text, html } = renderRfqEmail(posting, {
          trackingToken: externalRef,
          quoteUrl: quoteUrlFor(appUrl, recipient),
        });
        await email.send({ to: recipient.email, subject, text, html });
      }
      return { externalRef };
    },
    async fetchQuotes() {
      return [];
    },
  };
}

/**
 * Dev/test provider: logs postings, captures them in memory, and serves quote
 * fixtures set via `setQuotes` — the trade-market analogue of
 * memoryEmailProvider().sent.
 */
export function consoleTradeMarketProvider(): TradeMarketProvider & {
  posted: { posting: RfqPosting; recipients: RfqRecipient[] }[];
  setQuotes(externalRef: string, quotes: NormalizedQuote[]): void;
} {
  const posted: { posting: RfqPosting; recipients: RfqRecipient[] }[] = [];
  const quoteFixtures = new Map<string, NormalizedQuote[]>();
  return {
    name: "console",
    posted,
    setQuotes(externalRef, quotes) {
      quoteFixtures.set(externalRef, quotes);
    },
    capabilities() {
      return { requiresRecipients: false, canFetchQuotes: true, supportsWebhooks: false };
    },
    async postJob({ posting, recipients }) {
      posted.push({ posting, recipients: recipients ?? [] });
      console.log(
        `[trade-market:console] rfq=${posting.rfqId} category=${posting.category} suburb=${posting.suburb} recipients=${recipients?.length ?? 0}`,
      );
      return { externalRef: `console-${posting.rfqId}` };
    },
    async fetchQuotes(externalRef) {
      return quoteFixtures.get(externalRef) ?? [];
    },
  };
}
