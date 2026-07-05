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

/**
 * Render the outbound RFQ email from the posting ALONE. Taking `RfqPosting`
 * as the only data argument is the anonymization guarantee: address, lot and
 * person fields don't exist on it, so they cannot leak into the body.
 */
export function renderRfqEmail(
  posting: RfqPosting,
  trackingToken?: string,
): { subject: string; text: string } {
  const subject = trackingToken
    ? `[GS-RFQ ${trackingToken}] Quote requested: ${posting.title}`
    : `Quote requested: ${posting.title}`;
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
    `To quote, reply referencing: ${posting.replyRef}`,
    "",
    "The exact property address is shared with the successful contractor once the committee awards the job.",
  ];
  return { subject, text: lines.join("\n") };
}

/**
 * The scheme's own contractor book as a first-class trade market: the RFQ is
 * emailed to the scheme's registered contractors via the injected
 * EmailProvider. Quotes come back out-of-band (reply → officer records them),
 * so fetchQuotes is empty by design. No fees exist on this channel.
 */
export function schemeBookTradeMarketProvider(email: EmailProvider): TradeMarketProvider {
  return {
    name: "scheme_book",
    capabilities() {
      return { requiresRecipients: true, canFetchQuotes: false, supportsWebhooks: false };
    },
    async postJob({ posting, recipients }) {
      if (!recipients || recipients.length === 0) {
        throw new Error("trade-market: scheme_book postJob requires at least one recipient");
      }
      const { subject, text } = renderRfqEmail(posting);
      for (const recipient of recipients) {
        await email.send({ to: recipient.email, subject, text });
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
export function emailRfqTradeMarketProvider(email: EmailProvider): TradeMarketProvider {
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
      // The token IS the external ref — an inbound reply's subject resolves
      // straight back to the posting.
      const { subject, text } = renderRfqEmail(posting, externalRef);
      for (const recipient of recipients) {
        await email.send({ to: recipient.email, subject, text });
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
