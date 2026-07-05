import {
  contractors,
  lots,
  maintenanceRequests,
  people,
  quotes,
  rfqChannels,
  rfqs,
  schemes,
  workOrders,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  type RfqPosting,
  type RfqRecipient,
  type TradeMarketProvider,
  tradeMarketByName,
} from "@goodstrata/integrations";
import { addDays, formatCents } from "@goodstrata/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { registerDecisionAction, requestDecision } from "./decisions.js";
import { dispatchWorkOrder } from "./maintenance.js";

// ---------------------------------------------------------------------------
// Anonymization — enforced in code, twice over:
//  1. Text entering RFQ columns is scrubbed of every identifier we hold for
//     the scheme/lot/reporter (plus generic email/phone patterns).
//  2. The outbound `RfqPosting` is built from RFQ columns ONLY — address, lot
//     and person fields do not exist on the struct, so they cannot leak.
// The exact address is revealed post-award via the work-order dispatch email.
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** AU-style phone numbers (+61 / 0-prefixed, 8–10 digits with separators). */
const PHONE_PATTERN = /(?:\+?61[\s(-]*|\(?0)\d(?:[\s)-]*\d){7,9}/g;
const REDACTED = "[redacted]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RfqIdentifiers {
  /** Literal strings to redact (names, addresses, plan numbers, …). */
  terms: (string | null | undefined)[];
  /** Lot/unit numbers — redacted as "lot 9" / "unit 9" / "apt 9" phrases. */
  lotNumbers: (string | null | undefined)[];
}

/** Scrub prose destined for an RFQ column. Pure — unit-testable in isolation. */
export function anonymizeRfqText(text: string, identifiers: RfqIdentifiers): string {
  let out = text.replace(EMAIL_PATTERN, REDACTED).replace(PHONE_PATTERN, REDACTED);
  for (const term of identifiers.terms) {
    const trimmed = term?.trim();
    if (!trimmed || trimmed.length < 3) continue; // too short to be identifying
    out = out.replace(new RegExp(escapeRegExp(trimmed), "gi"), REDACTED);
  }
  for (const lotNumber of identifiers.lotNumbers) {
    const trimmed = lotNumber?.trim();
    if (!trimmed) continue;
    out = out.replace(
      new RegExp(
        String.raw`\b(?:lot|unit|apartment|apt)\s*#?\s*${escapeRegExp(trimmed)}\b`,
        "gi",
      ),
      REDACTED,
    );
  }
  return out;
}

/** Every identifier we hold that must never leave the platform pre-award. */
async function loadAnonymizationContext(
  ctx: ServiceContext,
  schemeId: string,
  request: { lotId: string | null; reportedByPersonId: string | null },
) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  const lot = request.lotId
    ? await ctx.db.query.lots.findFirst({
        where: and(eq(lots.id, request.lotId), eq(lots.schemeId, schemeId)),
      })
    : null;
  const person = request.reportedByPersonId
    ? await ctx.db.query.people.findFirst({
        where: and(eq(people.id, request.reportedByPersonId), eq(people.schemeId, schemeId)),
      })
    : null;

  const identifiers: RfqIdentifiers = {
    terms: [
      scheme.name,
      scheme.addressLine1,
      scheme.addressLine2,
      scheme.planOfSubdivision,
      lot?.streetAddress,
      person?.givenName,
      person?.familyName,
      person?.companyName,
      person?.email,
      person?.phone,
      person?.givenName && person?.familyName
        ? `${person.givenName} ${person.familyName}`
        : null,
    ],
    lotNumbers: [lot?.lotNumber, lot?.unitNumber],
  };
  return { scheme, identifiers };
}

async function getRfqOrThrow(ctx: ServiceContext, schemeId: string, rfqId: string) {
  const rfq = await ctx.db.query.rfqs.findFirst({
    where: and(eq(rfqs.id, rfqId), eq(rfqs.schemeId, schemeId)),
  });
  if (!rfq) throw notFound("RFQ");
  return rfq;
}

// ---------------------------------------------------------------------------
// Create — snapshots suburb, drafts an anonymized spec from the request.
// ---------------------------------------------------------------------------

export const createRfqInput = z.object({
  requestId: z.string(),
  title: z.string().min(3).max(200).optional(),
  category: z.string().min(2).max(50).optional(),
  /** ISO date quotes are due by. */
  quotesDueOn: z.string().optional(),
});
export type CreateRfqInput = z.infer<typeof createRfqInput>;

export async function createRfqFromRequest(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateRfqInput,
) {
  const request = await ctx.db.query.maintenanceRequests.findFirst({
    where: and(
      eq(maintenanceRequests.id, input.requestId),
      eq(maintenanceRequests.schemeId, schemeId),
    ),
  });
  if (!request) throw notFound("Maintenance request");
  if (request.status !== "triaged") {
    throw new DomainError("NOT_TRIAGED", "Request must be triaged before requesting quotes", 409);
  }
  const category = input.category ?? request.category;
  if (!category) {
    throw new DomainError("MISSING_CATEGORY", "A trade category is required for an RFQ", 422);
  }

  const { scheme, identifiers } = await loadAnonymizationContext(ctx, schemeId, request);
  const title = anonymizeRfqText(input.title ?? request.title, identifiers);
  // Default spec drafted straight from the (scrubbed) request; the agent or an
  // officer refines it via applyRfqSpec before dispatch.
  const specMd = [
    "## Scope of works",
    "",
    anonymizeRfqText(request.description, identifiers),
    "",
    `- Trade category: ${category}`,
    `- Location: ${scheme.suburb} (exact address is shared with the successful contractor after award)`,
  ].join("\n");

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(rfqs)
      .values({
        schemeId,
        requestId: request.id,
        title,
        specMd,
        category,
        // Suburb snapshot: this is ALL the location external parties get.
        suburb: scheme.suburb,
        buildingType: null, // schemes carry no building-type column yet
        quotesDueOn: input.quotesDueOn ?? null,
        status: "draft",
      })
      .returning();
    const rfq = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `rfq:${rfq.id}`,
      type: "rfq.created",
      payload: { rfqId: rfq.id, requestId: request.id, title: rfq.title, category },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return rfq;
  });
}

// ---------------------------------------------------------------------------
// Spec editing — the agent (or an officer) writes the spec; the scrub runs
// again on whatever they wrote. The agent has no dispatch/quote/award tool.
// ---------------------------------------------------------------------------

export const applyRfqSpecInput = z.object({
  title: z.string().min(3).max(200),
  specMd: z.string().min(20).max(20000),
  category: z.string().min(2).max(50),
  quotesDueOn: z.string().optional(),
});
export type ApplyRfqSpecInput = z.infer<typeof applyRfqSpecInput>;

export async function applyRfqSpec(
  ctx: ServiceContext,
  schemeId: string,
  rfqId: string,
  input: ApplyRfqSpecInput,
) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  if (rfq.status !== "draft") {
    throw new DomainError("BAD_STATUS", `Cannot edit the spec of a ${rfq.status} RFQ`, 409);
  }
  const request = await ctx.db.query.maintenanceRequests.findFirst({
    where: eq(maintenanceRequests.id, rfq.requestId),
  });
  if (!request) throw notFound("Maintenance request");
  const { identifiers } = await loadAnonymizationContext(ctx, schemeId, request);

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(rfqs)
      .set({
        title: anonymizeRfqText(input.title, identifiers),
        specMd: anonymizeRfqText(input.specMd, identifiers),
        category: input.category,
        quotesDueOn: input.quotesDueOn ?? rfq.quotesDueOn,
      })
      .where(eq(rfqs.id, rfqId))
      .returning();
    const updated = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `rfq:${rfqId}`,
      type: "rfq.spec_drafted",
      payload: { rfqId, title: updated.title, category: updated.category },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Dispatch — fan out through TradeMarketProviders, one rfq_channels row per
// send. AGNOSTIC BY ARCHITECTURE: the scheme's own book is just a provider.
// ---------------------------------------------------------------------------

export const dispatchRfqInput = z.object({
  /** Approved scheme-book contractors to send to directly. */
  contractorIds: z.array(z.string()).default([]),
  /** Tradie email addresses not (yet) in any book. */
  invitedEmails: z.array(z.string().email()).default([]),
  /** Broadcast providers (marketplaces / console) — no recipients needed. */
  broadcastProviders: z.array(z.string()).default([]),
});
export type DispatchRfqInput = z.infer<typeof dispatchRfqInput>;

function requireProvider(ctx: ServiceContext, name: string): TradeMarketProvider {
  try {
    return tradeMarketByName(ctx.integrations, name);
  } catch {
    throw new DomainError(
      "PROVIDER_NOT_ENABLED",
      `Trade-market provider "${name}" is not enabled`,
      422,
    );
  }
}

/**
 * Build the outbound posting from RFQ COLUMNS ONLY. This function is the
 * anonymization choke point: it takes the rfq row and nothing else, and
 * `RfqPosting` has no address/lot/person fields to fill.
 */
function buildRfqPosting(rfq: {
  id: string;
  title: string;
  specMd: string;
  category: string;
  suburb: string;
  buildingType: string | null;
  quotesDueOn: string | null;
}): RfqPosting {
  return {
    rfqId: rfq.id,
    title: rfq.title,
    scopeMd: rfq.specMd,
    category: rfq.category,
    suburb: rfq.suburb,
    buildingType: rfq.buildingType,
    quotesDueOn: rfq.quotesDueOn,
    replyRef: `rfq:${rfq.id}`,
  };
}

export async function dispatchRfq(
  ctx: ServiceContext,
  schemeId: string,
  rfqId: string,
  input: DispatchRfqInput,
) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  if (rfq.status !== "draft") {
    throw new DomainError("BAD_STATUS", `Cannot dispatch a ${rfq.status} RFQ`, 409);
  }
  if (rfq.specMd.trim().length === 0) {
    throw new DomainError("EMPTY_SPEC", "RFQ has no scope of works to send", 422);
  }
  const channelCount =
    input.contractorIds.length + input.invitedEmails.length + input.broadcastProviders.length;
  if (channelCount === 0) {
    throw new DomainError("NO_CHANNELS", "Select at least one contractor, email or provider", 422);
  }

  // Direct sends go to APPROVED contractors with an email address.
  const bookContractors =
    input.contractorIds.length > 0
      ? await ctx.db.query.contractors.findMany({
          where: and(
            inArray(contractors.id, input.contractorIds),
            eq(contractors.schemeId, schemeId),
            eq(contractors.status, "approved"),
          ),
        })
      : [];
  if (bookContractors.length !== input.contractorIds.length) throw notFound("Approved contractor");
  for (const contractor of bookContractors) {
    if (!contractor.email) {
      throw new DomainError(
        "CONTRACTOR_NO_EMAIL",
        `${contractor.businessName} has no email address on file`,
        422,
      );
    }
  }

  const posting = buildRfqPosting(rfq);

  // One provider call per group; every send gets its own channel row.
  interface ChannelGroup {
    provider: TradeMarketProvider;
    recipients?: RfqRecipient[];
    channelIds: string[];
    contractorIdByChannel: Map<string, string | null>;
  }
  const groups: ChannelGroup[] = [];

  await ctx.db.transaction(async (tx) => {
    if (bookContractors.length > 0) {
      const provider = requireProvider(ctx, "scheme_book");
      const group: ChannelGroup = {
        provider,
        recipients: bookContractors.map((c) => ({
          email: c.email!,
          businessName: c.businessName,
          contactName: c.contactName,
        })),
        channelIds: [],
        contractorIdByChannel: new Map(),
      };
      for (const contractor of bookContractors) {
        const rows = await tx
          .insert(rfqChannels)
          .values({ schemeId, rfqId, provider: provider.name, contractorId: contractor.id })
          .returning();
        group.channelIds.push(rows[0]!.id);
        group.contractorIdByChannel.set(rows[0]!.id, contractor.id);
      }
      groups.push(group);
    }

    if (input.invitedEmails.length > 0) {
      const provider = requireProvider(ctx, "email_rfq");
      const group: ChannelGroup = {
        provider,
        recipients: input.invitedEmails.map((email) => ({ email })),
        channelIds: [],
        contractorIdByChannel: new Map(),
      };
      for (const _email of input.invitedEmails) {
        const rows = await tx
          .insert(rfqChannels)
          .values({ schemeId, rfqId, provider: provider.name })
          .returning();
        group.channelIds.push(rows[0]!.id);
        group.contractorIdByChannel.set(rows[0]!.id, null);
      }
      groups.push(group);
    }

    for (const name of input.broadcastProviders) {
      const provider = requireProvider(ctx, name);
      if (provider.capabilities().requiresRecipients) {
        throw new DomainError(
          "PROVIDER_NEEDS_RECIPIENTS",
          `Provider "${name}" needs explicit recipients and cannot broadcast`,
          422,
        );
      }
      const rows = await tx
        .insert(rfqChannels)
        .values({ schemeId, rfqId, provider: provider.name })
        .returning();
      groups.push({
        provider,
        channelIds: [rows[0]!.id],
        contractorIdByChannel: new Map([[rows[0]!.id, null]]),
      });
    }
  });

  let channelsSent = 0;
  let channelsFailed = 0;
  for (const group of groups) {
    try {
      const { externalRef } = await group.provider.postJob({
        posting,
        recipients: group.recipients,
      });
      channelsSent += group.channelIds.length;
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(rfqChannels)
          .set({ status: "sent", providerRef: externalRef, sentAt: ctx.clock.now() })
          .where(inArray(rfqChannels.id, group.channelIds));
        for (const channelId of group.channelIds) {
          await publishEvent(tx, {
            schemeId,
            stream: `rfq:${rfqId}`,
            type: "rfq.channel.sent",
            payload: {
              rfqId,
              channelId,
              provider: group.provider.name,
              contractorId: group.contractorIdByChannel.get(channelId) ?? null,
            },
            actor: ctx.actor,
            ...causationFields(ctx),
          });
        }
      });
    } catch (error) {
      channelsFailed += group.channelIds.length;
      const message = error instanceof Error ? error.message : String(error);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(rfqChannels)
          .set({ status: "failed" })
          .where(inArray(rfqChannels.id, group.channelIds));
        for (const channelId of group.channelIds) {
          await publishEvent(tx, {
            schemeId,
            stream: `rfq:${rfqId}`,
            type: "rfq.channel.failed",
            payload: { rfqId, channelId, provider: group.provider.name, error: message },
            actor: ctx.actor,
            ...causationFields(ctx),
          });
        }
      });
    }
  }

  await ctx.db.transaction(async (tx) => {
    await tx.update(rfqs).set({ status: "published" }).where(eq(rfqs.id, rfqId));
    await tx
      .update(maintenanceRequests)
      .set({ status: "quoting" })
      .where(eq(maintenanceRequests.id, rfq.requestId));
    await publishEvent(tx, {
      schemeId,
      stream: `rfq:${rfqId}`,
      type: "rfq.dispatched",
      payload: {
        rfqId,
        providers: groups.map((g) => g.provider.name),
        channelsSent,
        channelsFailed,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return { rfqId, channelsSent, channelsFailed };
}

// ---------------------------------------------------------------------------
// Quotes — driver fetch or manual committee entry. ZERO HIDDEN MARGIN: fee
// fields are guarded here (422), CHECK-constrained in the DB, and required on
// the quote.received event payload.
// ---------------------------------------------------------------------------

export const recordQuoteInput = z
  .object({
    /** Existing contractor quoting, … */
    contractorId: z.string().optional(),
    /** …or an external tradie — becomes a `pending` contractors row. */
    contact: z
      .object({
        businessName: z.string().min(2).max(200),
        abn: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      })
      .optional(),
    /** Channel the quote arrived through; omit for manual/phone entry. */
    channelId: z.string().optional(),
    amountCents: z.number().int().positive(),
    /** ISO date the quote is valid until. */
    validUntil: z.string().optional(),
    notes: z.string().max(5000).optional(),
    licenceConfirmed: z.boolean().default(false),
    insuranceConfirmed: z.boolean().default(false),
    platformFeeCents: z.number().int().min(0).default(0),
    referralFeeCents: z.number().int().min(0).default(0),
    /** Required whenever either fee is nonzero. */
    feeRecipient: z.string().min(2).max(200).optional(),
  })
  .refine((v) => v.contractorId || v.contact, {
    message: "Provide contractorId or the external tradie's contact details",
  });
export type RecordQuoteInput = z.infer<typeof recordQuoteInput>;

/** Integer-cents guard for callers that bypass the zod schema. */
function assertCents(value: number, label: string, { positive = false } = {}): void {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${label} must be a ${positive ? "positive " : "non-negative "}integer number of cents`,
      422,
    );
  }
}

export async function recordQuote(
  ctx: ServiceContext,
  schemeId: string,
  rfqId: string,
  input: RecordQuoteInput,
) {
  assertCents(input.amountCents, "amountCents", { positive: true });
  assertCents(input.platformFeeCents, "platformFeeCents");
  assertCents(input.referralFeeCents, "referralFeeCents");
  // ZERO HIDDEN MARGIN: a fee without a named recipient cannot be recorded.
  if (input.platformFeeCents + input.referralFeeCents > 0 && !input.feeRecipient) {
    throw new DomainError(
      "FEE_UNDISCLOSED",
      "A platform/referral fee requires a named fee recipient",
      422,
    );
  }

  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  if (rfq.status !== "published" && rfq.status !== "quoting") {
    throw new DomainError("BAD_STATUS", `Cannot record a quote on a ${rfq.status} RFQ`, 409);
  }
  if (input.channelId) {
    const channel = await ctx.db.query.rfqChannels.findFirst({
      where: and(eq(rfqChannels.id, input.channelId), eq(rfqChannels.rfqId, rfqId)),
    });
    if (!channel) throw notFound("RFQ channel");
  }

  return await ctx.db.transaction(async (tx) => {
    // Resolve the quoting party to a contractors row — external tradies get a
    // `pending` row so quotes.contractorId stays NOT NULL.
    let contractorId = input.contractorId ?? null;
    if (contractorId) {
      const contractor = await tx.query.contractors.findFirst({
        where: and(eq(contractors.id, contractorId), eq(contractors.schemeId, schemeId)),
      });
      if (!contractor) throw notFound("Contractor");
    } else {
      const contact = input.contact!;
      const existing = contact.email
        ? await tx.query.contractors.findFirst({
            where: and(eq(contractors.schemeId, schemeId), eq(contractors.email, contact.email)),
          })
        : undefined;
      if (existing) {
        contractorId = existing.id;
      } else {
        const rows = await tx
          .insert(contractors)
          .values({
            schemeId,
            businessName: contact.businessName,
            abn: contact.abn ?? null,
            email: contact.email ?? null,
            phone: contact.phone ?? null,
            tradeCategories: [rfq.category],
            status: "pending",
          })
          .returning();
        contractorId = rows[0]!.id;
      }
    }

    const rows = await tx
      .insert(quotes)
      .values({
        schemeId,
        requestId: rfq.requestId,
        contractorId,
        rfqId,
        channelId: input.channelId ?? null,
        amountCents: input.amountCents,
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        licenceConfirmed: input.licenceConfirmed,
        insuranceConfirmed: input.insuranceConfirmed,
        platformFeeCents: input.platformFeeCents,
        referralFeeCents: input.referralFeeCents,
        feeRecipient: input.feeRecipient ?? null,
        status: "received",
      })
      .returning();
    const quote = rows[0]!;

    if (input.channelId) {
      await tx
        .update(rfqChannels)
        .set({ status: "responded" })
        .where(eq(rfqChannels.id, input.channelId));
    }
    if (rfq.status === "published") {
      await tx.update(rfqs).set({ status: "quoting" }).where(eq(rfqs.id, rfqId));
    }

    // Fees hit the audit log unconditionally — there is no fee-less shape.
    await publishEvent(tx, {
      schemeId,
      stream: `rfq:${rfqId}`,
      type: "quote.received",
      payload: {
        quoteId: quote.id,
        rfqId,
        contractorId,
        amountCents: quote.amountCents,
        platformFeeCents: quote.platformFeeCents,
        referralFeeCents: quote.referralFeeCents,
        feeRecipient: quote.feeRecipient,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return quote;
  });
}

// ---------------------------------------------------------------------------
// Comparison — deterministic sort and summary. Code, never an LLM, orders the
// quotes, and the fee columns are ALWAYS in the output.
// ---------------------------------------------------------------------------

/** Human-readable fee disclosure; "none" only when both fees are zero. */
export function quoteFeeDisclosure(quote: {
  platformFeeCents: number;
  referralFeeCents: number;
  feeRecipient: string | null;
}): string {
  if (quote.platformFeeCents + quote.referralFeeCents === 0) return "none";
  const parts: string[] = [];
  if (quote.platformFeeCents > 0) parts.push(`${formatCents(quote.platformFeeCents)} platform`);
  if (quote.referralFeeCents > 0) parts.push(`${formatCents(quote.referralFeeCents)} referral`);
  return `${parts.join(" + ")} → ${quote.feeRecipient ?? "UNDISCLOSED"}`;
}

export interface QuoteComparisonRow {
  quoteId: string;
  contractorId: string;
  contractorName: string;
  amountCents: number;
  platformFeeCents: number;
  referralFeeCents: number;
  feeRecipient: string | null;
  feeDisclosure: string;
  licenceConfirmed: boolean;
  insuranceConfirmed: boolean;
  validUntil: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
}

export async function compareQuotes(ctx: ServiceContext, schemeId: string, rfqId: string) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  const quoteRows = await ctx.db.query.quotes.findMany({
    where: and(eq(quotes.rfqId, rfqId), eq(quotes.schemeId, schemeId)),
  });

  const contractorIds = [...new Set(quoteRows.map((q) => q.contractorId))];
  const contractorRows =
    contractorIds.length > 0
      ? await ctx.db.query.contractors.findMany({
          where: inArray(contractors.id, contractorIds),
          columns: { id: true, businessName: true },
        })
      : [];
  const names = new Map(contractorRows.map((c) => [c.id, c.businessName]));

  // Deterministic: cheapest first, ties broken by arrival then id. No model
  // opinion anywhere in this ordering.
  const rows: QuoteComparisonRow[] = quoteRows
    .map((q) => ({
      quoteId: q.id,
      contractorId: q.contractorId,
      contractorName: names.get(q.contractorId) ?? "Unknown contractor",
      amountCents: q.amountCents,
      platformFeeCents: q.platformFeeCents,
      referralFeeCents: q.referralFeeCents,
      feeRecipient: q.feeRecipient,
      feeDisclosure: quoteFeeDisclosure(q),
      licenceConfirmed: q.licenceConfirmed,
      insuranceConfirmed: q.insuranceConfirmed,
      validUntil: q.validUntil,
      notes: q.notes,
      status: q.status,
      createdAt: q.createdAt,
    }))
    .sort(
      (a, b) =>
        a.amountCents - b.amountCents ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.quoteId.localeCompare(b.quoteId),
    );

  const summaryMd = [
    "| # | Contractor | Amount | Fees | Licence | Insurance | Valid until |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.contractorName} | ${formatCents(r.amountCents)} | ${r.feeDisclosure} | ${
          r.licenceConfirmed ? "yes" : "unconfirmed"
        } | ${r.insuranceConfirmed ? "yes" : "unconfirmed"} | ${r.validUntil ?? "—"} |`,
    ),
  ].join("\n");

  return { rfqId: rfq.id, quotes: rows, summaryMd };
}

// ---------------------------------------------------------------------------
// Award — AI NEVER PICKS. requestAward opens a committee decision carrying the
// full comparison; the award itself runs ONLY as that decision's follow-up
// (executeDecisionFollowUp after human votes). awardQuote is module-private:
// this service exposes no direct award path, flag or otherwise.
// ---------------------------------------------------------------------------

export async function requestAward(
  ctx: ServiceContext,
  schemeId: string,
  rfqId: string,
  quoteId: string,
) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  if (rfq.status !== "published" && rfq.status !== "quoting") {
    throw new DomainError("BAD_STATUS", `Cannot award a ${rfq.status} RFQ`, 409);
  }
  const quote = await ctx.db.query.quotes.findFirst({
    where: and(eq(quotes.id, quoteId), eq(quotes.rfqId, rfqId), eq(quotes.schemeId, schemeId)),
  });
  if (!quote) throw notFound("Quote");
  if (quote.status !== "received") {
    throw new DomainError("BAD_STATUS", `Cannot nominate a ${quote.status} quote for award`, 409);
  }

  const comparison = await compareQuotes(ctx, schemeId, rfqId);
  const nominated = comparison.quotes.find((q) => q.quoteId === quoteId)!;

  const decision = await requestDecision(ctx, {
    schemeId,
    kind: "quote_approval",
    title: `Award quotes: ${rfq.title} — ${formatCents(quote.amountCents)} (${nominated.contractorName})`,
    summaryMd: [
      `Award **${rfq.title}** to **${nominated.contractorName}** for **${formatCents(quote.amountCents)}**.`,
      "",
      // The fee line renders whether or not fees exist — silence is never ambiguity.
      `**Fees: ${nominated.feeDisclosure}**`,
      "",
      "On approval, a work order is created for the quoted amount and dispatched to the contractor with the full property address (post-award reveal).",
      "",
      "### Quote comparison",
      "",
      comparison.summaryMd,
    ].join("\n"),
    subject: { type: "rfq", id: rfqId },
    deciderRole: "committee",
    dueAt: addDays(ctx.clock.now(), 7),
    followUp: {
      type: "action",
      action: "tradeRfq.awardQuote",
      args: { rfqId, quoteId },
    },
    requestedByRunId: ctx.actor.kind === "agent" ? ctx.actor.agentRunId : undefined,
  });

  await ctx.db.update(rfqs).set({ decisionId: decision.id }).where(eq(rfqs.id, rfqId));

  return { decisionId: decision.id, rfqId, quoteId };
}

/**
 * NOT exported. The only caller is the decision follow-up executor below —
 * awarding without an approved committee decision is impossible through this
 * service's API. DETERMINISTIC MONEY: approvedAmountCents is the quote's
 * number copied verbatim; no arithmetic happens on the AI/RFQ path.
 */
async function awardQuote(
  ctx: ServiceContext,
  schemeId: string,
  rfqId: string,
  quoteId: string,
  decisionId: string,
) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  if (rfq.status === "awarded") return { rfqId, workOrderId: null }; // idempotent (executor retries)
  const quote = await ctx.db.query.quotes.findFirst({
    where: and(eq(quotes.id, quoteId), eq(quotes.rfqId, rfqId), eq(quotes.schemeId, schemeId)),
  });
  if (!quote) throw notFound("Quote");

  const workOrderId = await ctx.db.transaction(async (tx) => {
    await tx.update(quotes).set({ status: "selected" }).where(eq(quotes.id, quoteId));
    await tx
      .update(quotes)
      .set({ status: "declined" })
      .where(and(eq(quotes.rfqId, rfqId), ne(quotes.id, quoteId), eq(quotes.status, "received")));
    await tx
      .update(rfqs)
      .set({ status: "awarded", awardedQuoteId: quoteId, decisionId })
      .where(eq(rfqs.id, rfqId));
    // External tradies entered as `pending` — winning the award approves them
    // (the dispatch email path requires an approved contractor with an email).
    await tx
      .update(contractors)
      .set({ status: "approved" })
      .where(and(eq(contractors.id, quote.contractorId), eq(contractors.status, "pending")));

    const rows = await tx
      .insert(workOrders)
      .values({
        schemeId,
        requestId: rfq.requestId,
        contractorId: quote.contractorId,
        quoteId,
        scope: rfq.specMd,
        approvedAmountCents: quote.amountCents, // verbatim — no new money math
        status: "draft",
        decisionId,
      })
      .returning();
    const wo = rows[0]!;

    await tx
      .update(maintenanceRequests)
      .set({ status: "approved" })
      .where(eq(maintenanceRequests.id, rfq.requestId));

    await publishEvent(tx, {
      schemeId,
      stream: `work_order:${wo.id}`,
      type: "work_order.created",
      payload: {
        workOrderId: wo.id,
        requestId: rfq.requestId,
        contractorId: quote.contractorId,
        amountCents: quote.amountCents,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    await publishEvent(tx, {
      schemeId,
      stream: `rfq:${rfqId}`,
      type: "rfq.awarded",
      payload: {
        rfqId,
        quoteId,
        workOrderId: wo.id,
        contractorId: quote.contractorId,
        amountCents: quote.amountCents,
        platformFeeCents: quote.platformFeeCents,
        referralFeeCents: quote.referralFeeCents,
        feeRecipient: quote.feeRecipient,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return wo.id;
  });

  // Post-award reveal: the existing dispatch rail emails the full address.
  await dispatchWorkOrder(ctx, schemeId, workOrderId);
  return { rfqId, workOrderId };
}

// Executor: the committee said yes — award it. This registration is the ONLY
// path into awardQuote.
registerDecisionAction("tradeRfq.awardQuote", async (ctx, args, decision) => {
  const { rfqId, quoteId } = z.object({ rfqId: z.string(), quoteId: z.string() }).parse(args);
  await awardQuote(ctx, decision.schemeId, rfqId, quoteId, decision.id);
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRfqs(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.rfqs.findMany({
    where: eq(rfqs.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
  if (rows.length === 0) return [];

  // Denormalise what the list actually shows — one query each, no N+1.
  const [quoteRows, requestRows] = await Promise.all([
    ctx.db.query.quotes.findMany({
      where: eq(quotes.schemeId, schemeId),
      columns: { id: true, rfqId: true },
    }),
    ctx.db.query.maintenanceRequests.findMany({
      where: eq(maintenanceRequests.schemeId, schemeId),
      columns: { id: true, title: true },
    }),
  ]);
  const quoteCounts = new Map<string, number>();
  for (const q of quoteRows) {
    if (q.rfqId) quoteCounts.set(q.rfqId, (quoteCounts.get(q.rfqId) ?? 0) + 1);
  }
  const requestTitles = new Map(requestRows.map((r) => [r.id, r.title]));

  return rows.map((r) => ({
    ...r,
    quoteCount: quoteCounts.get(r.id) ?? 0,
    requestTitle: requestTitles.get(r.requestId) ?? null,
  }));
}

export async function getRfq(ctx: ServiceContext, schemeId: string, rfqId: string) {
  const rfq = await getRfqOrThrow(ctx, schemeId, rfqId);
  const channels = await ctx.db.query.rfqChannels.findMany({
    where: and(eq(rfqChannels.rfqId, rfqId), eq(rfqChannels.schemeId, schemeId)),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  // Quotes come from the comparison so the fee columns are ALWAYS selected.
  const comparison = await compareQuotes(ctx, schemeId, rfqId);
  return { rfq, channels, quotes: comparison.quotes };
}
