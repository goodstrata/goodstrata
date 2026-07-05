import { randomUUID } from "node:crypto";
import {
  bankAccounts,
  type DbHandle,
  funds,
  fundTransactions,
  levyNoticeLines,
  levyNotices,
  lotLedgerEntries,
  paymentAllocations,
  payments,
  receipts,
  schemes,
  webhookEvents,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import type { InboundPayment } from "@goodstrata/integrations";
import { allocateByWeight, formatCents, fromDateOnly, toDateOnly } from "@goodstrata/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { matchPayment, type OpenNotice } from "../engines/reconcile.js";
import { DomainError, notFound } from "../errors.js";
import { sendEmail } from "./comms.js";
import { getSchemeTrustAccount, trustAccountForInboundPayment } from "./trustAccounts.js";

export interface RecordPaymentResult {
  paymentId: string;
  matched: boolean;
  levyNoticeId?: string;
  receiptNumber?: string;
  duplicate?: boolean;
}

/** Notice statuses that still accept money. */
const OPEN_NOTICE_STATUSES = ["issued", "partially_paid", "overdue"] as const;
/** Notice statuses whose reference must never be amount-guessed onto another lot. */
const SETTLED_NOTICE_STATUSES = ["paid", "written_off"] as const;

/** Reject junk before it touches the ledger: positive integer cents, AUD only. */
function validateInboundAmount(
  inbound: Pick<InboundPayment, "providerRef" | "amountCents" | "currency">,
) {
  if (!Number.isSafeInteger(inbound.amountCents) || inbound.amountCents <= 0) {
    throw new DomainError(
      "INVALID_PAYMENT",
      `payment ${inbound.providerRef}: invalid amount (${inbound.amountCents})`,
      422,
    );
  }
  if (inbound.currency && inbound.currency !== "AUD") {
    throw new DomainError(
      "INVALID_PAYMENT",
      `payment ${inbound.providerRef}: unsupported currency ${inbound.currency}`,
      422,
    );
  }
}

/**
 * Resolve which scheme an inbound payment belongs to. Hierarchy:
 *  1. The payment reference equals a levy notice's PayID.
 *  2. The reference equals a scheme trust account's PayID root.
 *  3. The destination account number is a scheme's own collection account —
 *     covers typo'd references on direct BSB/account transfers, which then
 *     park as UNMATCHED in that scheme instead of being dropped.
 */
async function resolveSchemeForInbound(
  ctx: ServiceContext,
  inbound: InboundPayment,
): Promise<string> {
  if (inbound.payid) {
    const noticeByRef = await ctx.db.query.levyNotices.findFirst({
      where: eq(levyNotices.payid, inbound.payid),
    });
    if (noticeByRef) return noticeByRef.schemeId;

    const accountByRoot = await ctx.db.query.bankAccounts.findFirst({
      where: eq(bankAccounts.payidRoot, inbound.payid),
    });
    if (accountByRoot) return accountByRoot.schemeId;
  }

  if (inbound.accountNumber) {
    const accountByNumber = await ctx.db.query.bankAccounts.findFirst({
      where: eq(bankAccounts.accountNumber, inbound.accountNumber),
    });
    if (accountByNumber) return accountByNumber.schemeId;
  }

  throw new DomainError(
    "UNATTRIBUTABLE_PAYMENT",
    `payment ${inbound.providerRef}: cannot resolve scheme (unknown reference ${inbound.payid ?? "—"})`,
    422,
  );
}

/**
 * Apply a payment to a notice inside an open transaction: allocation, lot
 * ledger credit, notice status, pro-rata fund split, matched event and receipt
 * (+ receipt.issued event). The single money path shared by webhook matching,
 * manual recording and manual matching — the chain is identical for all rails.
 */
async function applyPaymentToNotice(
  ctx: ServiceContext,
  tx: DbHandle,
  payment: { id: string; schemeId: string; amountCents: number },
  noticeId: string,
  paidAt: Date,
  via: "payid" | "amount" | "manual",
): Promise<{ levyNoticeId: string; receiptNumber: string }> {
  const { schemeId } = payment;
  const notice = await tx.query.levyNotices.findFirst({
    where: and(eq(levyNotices.id, noticeId), eq(levyNotices.schemeId, schemeId)),
  });
  if (!notice) throw notFound("Levy notice");

  await tx.insert(paymentAllocations).values({
    paymentId: payment.id,
    levyNoticeId: notice.id,
    amountCents: payment.amountCents,
  });

  // Lot ledger credit (payments are negative). An overpayment simply drives
  // the lot balance negative — a credit the next levy charge absorbs.
  await tx.insert(lotLedgerEntries).values({
    schemeId,
    lotId: notice.lotId,
    kind: "payment",
    amountCents: -payment.amountCents,
    levyNoticeId: notice.id,
    paymentId: payment.id,
    effectiveOn: toDateOnly(paidAt),
  });

  // Notice status from total allocations.
  const allocations = await tx.query.paymentAllocations.findMany({
    where: eq(paymentAllocations.levyNoticeId, notice.id),
  });
  const allocated = allocations.reduce((a, r) => a + r.amountCents, 0);
  const newStatus = allocated >= notice.totalCents ? "paid" : "partially_paid";
  await tx.update(levyNotices).set({ status: newStatus }).where(eq(levyNotices.id, notice.id));

  // Fund split pro-rata by the notice's lines.
  const lines = await tx.query.levyNoticeLines.findMany({
    where: eq(levyNoticeLines.levyNoticeId, notice.id),
  });
  if (lines.length > 0) {
    const split = allocateByWeight(
      payment.amountCents,
      lines.map((l) => l.amountCents),
    );
    const fundRows = await tx.query.funds.findMany({ where: eq(funds.schemeId, schemeId) });
    for (const [i, line] of lines.entries()) {
      const share = split[i]!;
      if (share === 0) continue;
      const fund = fundRows.find((f) => f.kind === line.fundKind);
      if (!fund) continue;
      await tx.insert(fundTransactions).values({
        schemeId,
        fundId: fund.id,
        amountCents: share,
        kind: "levy_receipt",
        reference: { paymentId: payment.id, levyNoticeId: notice.id },
        occurredAt: paidAt,
      });
      await tx
        .update(funds)
        .set({ balanceCents: sql`${funds.balanceCents} + ${share}` })
        .where(eq(funds.id, fund.id));
    }
  }

  // Compare-and-set: only a not-yet-applied payment may flip to matched. Two
  // concurrent applications of the same payment (double-click, two treasurers,
  // a retried request) serialize on the row lock — the loser sees 0 rows and
  // rolls back its allocation/ledger/fund writes instead of double-crediting.
  const flipped = await tx
    .update(payments)
    .set({ status: "matched" })
    .where(and(eq(payments.id, payment.id), inArray(payments.status, ["received", "unmatched"])))
    .returning({ id: payments.id });
  if (flipped.length === 0) {
    throw new DomainError(
      "PAYMENT_ALREADY_MATCHED",
      "Payment has already been matched — refusing to apply it twice",
      409,
    );
  }
  await publishEvent(tx, {
    schemeId,
    stream: `payment:${payment.id}`,
    type: "payment.matched",
    payload: {
      paymentId: payment.id,
      levyNoticeId: notice.id,
      via,
      amountCents: payment.amountCents,
    },
    actor: ctx.actor,
    ...causationFields(ctx),
  });

  // Receipt.
  const receiptNumber = `R-${notice.noticeNumber}-${allocations.length}`;
  const receiptRows = await tx
    .insert(receipts)
    .values({ schemeId, paymentId: payment.id, receiptNumber })
    .returning();
  await publishEvent(tx, {
    schemeId,
    stream: `payment:${payment.id}`,
    type: "receipt.issued",
    payload: {
      receiptId: receiptRows[0]!.id,
      paymentId: payment.id,
      receiptNumber,
    },
    actor: ctx.actor,
    ...causationFields(ctx),
  });

  return { levyNoticeId: notice.id, receiptNumber };
}

/**
 * Record an inbound payment (from a provider webhook) and reconcile it:
 * allocate to the matched notice, post the lot ledger credit, split the
 * receipt across funds pro-rata, and issue + email a receipt. Idempotent on
 * (provider, providerRef). A payment that resolves to a scheme but not a
 * notice is PARKED as `unmatched` (suspense) for manual matching — never
 * dropped, never guessed.
 */
export async function recordInboundPayment(
  ctx: ServiceContext,
  provider: string,
  inbound: InboundPayment,
): Promise<RecordPaymentResult> {
  validateInboundAmount(inbound);

  const schemeId = await resolveSchemeForInbound(ctx, inbound);

  // A provider timestamp we can't parse must not lose the payment — fall back
  // to the receive time and keep the original in `raw` for the audit trail.
  const parsedPaidAt = new Date(inbound.paidAt);
  const paidAt = Number.isNaN(parsedPaidAt.getTime()) ? ctx.clock.now() : parsedPaidAt;

  // Per-OC segregation guard (OC Act s 122): the money posts against THIS
  // scheme's own trust account, never a shared pool. Resolving it here binds
  // the reconciliation to the reference's scheme and to no other.
  await trustAccountForInboundPayment(ctx, schemeId);

  const result = await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(payments)
      .values({
        schemeId,
        provider,
        providerRef: inbound.providerRef,
        payid: inbound.payid,
        amountCents: inbound.amountCents,
        paidAt,
        payerName: inbound.payerName,
        status: "received",
        raw: inbound.raw ?? null,
      })
      .onConflictDoNothing({ target: [payments.provider, payments.providerRef] })
      .returning();
    const payment = inserted[0];
    if (!payment) {
      // Webhook replay — already processed.
      return { paymentId: "", matched: false, duplicate: true } as RecordPaymentResult;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `payment:${payment.id}`,
      type: "payment.received",
      payload: {
        paymentId: payment.id,
        amountCents: payment.amountCents,
        payid: payment.payid,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    const openNotices = await openNoticesForScheme(tx, schemeId);
    const settledPayids = await settledPayidsForScheme(tx, schemeId);
    const match = matchPayment(
      { payid: payment.payid, amountCents: payment.amountCents },
      openNotices,
      { settledPayids },
    );

    if (match.kind === "unmatched") {
      await parkUnmatched(ctx, tx, payment, match.reason);
      return { paymentId: payment.id, matched: false } as RecordPaymentResult;
    }

    const applied = await applyPaymentToNotice(
      ctx,
      tx,
      payment,
      match.levyNoticeId,
      paidAt,
      match.via,
    );

    return {
      paymentId: payment.id,
      matched: true,
      levyNoticeId: applied.levyNoticeId,
      receiptNumber: applied.receiptNumber,
    } as RecordPaymentResult;
  });

  // Receipt email after commit.
  if (result.matched && result.levyNoticeId) {
    await sendReceiptEmail(ctx, schemeId, result).catch((err) =>
      console.error("[payments] receipt email failed", err),
    );
  }

  return result;
}

/** Park a payment in the unmatched (suspense) state with its reason on the log. */
async function parkUnmatched(
  ctx: ServiceContext,
  tx: DbHandle,
  payment: { id: string; schemeId: string; amountCents: number; payid: string | null },
  reason: string,
) {
  await tx.update(payments).set({ status: "unmatched" }).where(eq(payments.id, payment.id));
  await publishEvent(tx, {
    schemeId: payment.schemeId,
    stream: `payment:${payment.id}`,
    type: "payment.unmatched",
    payload: {
      paymentId: payment.id,
      reason,
      amountCents: payment.amountCents,
      payid: payment.payid,
    },
    actor: ctx.actor,
    ...causationFields(ctx),
  });
}

export const recordManualPaymentInput = z.object({
  /** Allocate straight to this notice; omit to let the matcher try (else park). */
  levyNoticeId: z.string().optional(),
  amountCents: z.number().int().positive(),
  /** Date the money hit the bank account. */
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payerName: z.string().trim().min(1).max(200).optional(),
  /** Bank statement reference — doubles as the idempotency key when supplied. */
  reference: z.string().trim().min(1).max(120).optional(),
});
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentInput>;

/**
 * Manual-payment rail: a treasurer records a bank transfer that arrived
 * outside the provider webhook (no Monoova, cheque, EFT with a mangled
 * reference…). Runs the exact same allocation → ledger → funds → receipt →
 * email chain as the webhook path, and every step lands on the event log with
 * the treasurer as actor. Idempotent on ("manual", reference) when a bank
 * reference is supplied.
 */
export async function recordManualPayment(
  ctx: ServiceContext,
  schemeId: string,
  input: RecordManualPaymentInput,
): Promise<RecordPaymentResult> {
  const paidAt = fromDateOnly(input.paidAt);

  const result = await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(payments)
      .values({
        schemeId,
        provider: "manual",
        providerRef: input.reference ?? `manual-${randomUUID()}`,
        payid: null,
        amountCents: input.amountCents,
        paidAt,
        payerName: input.payerName ?? null,
        status: "received",
        raw: { recordedBy: ctx.actor, reference: input.reference ?? null },
      })
      .onConflictDoNothing({ target: [payments.provider, payments.providerRef] })
      .returning();
    const payment = inserted[0];
    if (!payment) {
      // Same bank reference recorded twice (e.g. a re-run statement import) —
      // absorb BEFORE any validation, don't double-credit.
      return { paymentId: "", matched: false, duplicate: true } as RecordPaymentResult;
    }

    // Validate the nominated notice inside the tx: a throw rolls the insert back.
    let notice: typeof levyNotices.$inferSelect | undefined;
    if (input.levyNoticeId) {
      notice = await tx.query.levyNotices.findFirst({
        where: and(eq(levyNotices.id, input.levyNoticeId), eq(levyNotices.schemeId, schemeId)),
      });
      if (!notice) throw notFound("Levy notice");
      if (!(OPEN_NOTICE_STATUSES as readonly string[]).includes(notice.status)) {
        throw new DomainError(
          "NOTICE_NOT_OPEN",
          `Notice ${notice.noticeNumber} is ${notice.status} — it no longer accepts payments`,
          422,
        );
      }
      await tx.update(payments).set({ payid: notice.payid }).where(eq(payments.id, payment.id));
    }

    await publishEvent(tx, {
      schemeId,
      stream: `payment:${payment.id}`,
      type: "payment.received",
      payload: {
        paymentId: payment.id,
        amountCents: payment.amountCents,
        payid: payment.payid,
        rail: "manual",
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    if (notice) {
      const applied = await applyPaymentToNotice(ctx, tx, payment, notice.id, paidAt, "manual");
      return {
        paymentId: payment.id,
        matched: true,
        levyNoticeId: applied.levyNoticeId,
        receiptNumber: applied.receiptNumber,
      } as RecordPaymentResult;
    }

    // No notice nominated — let the deterministic matcher try, else park.
    const openNotices = await openNoticesForScheme(tx, schemeId);
    const settledPayids = await settledPayidsForScheme(tx, schemeId);
    const match = matchPayment({ payid: null, amountCents: payment.amountCents }, openNotices, {
      settledPayids,
    });
    if (match.kind === "unmatched") {
      await parkUnmatched(ctx, tx, payment, match.reason);
      return { paymentId: payment.id, matched: false } as RecordPaymentResult;
    }
    const applied = await applyPaymentToNotice(
      ctx,
      tx,
      payment,
      match.levyNoticeId,
      paidAt,
      match.via,
    );
    return {
      paymentId: payment.id,
      matched: true,
      levyNoticeId: applied.levyNoticeId,
      receiptNumber: applied.receiptNumber,
    } as RecordPaymentResult;
  });

  if (result.matched && result.levyNoticeId) {
    await sendReceiptEmail(ctx, schemeId, result).catch((err) =>
      console.error("[payments] receipt email failed", err),
    );
  }
  return result;
}

/**
 * Manually match a PARKED (unmatched) payment to a notice — the treasurer
 * resolving the suspense queue. Applies the same allocation/receipt chain.
 */
export async function matchPaymentToNotice(
  ctx: ServiceContext,
  schemeId: string,
  paymentId: string,
  levyNoticeId: string,
): Promise<RecordPaymentResult> {
  const payment = await ctx.db.query.payments.findFirst({
    where: and(eq(payments.id, paymentId), eq(payments.schemeId, schemeId)),
  });
  if (!payment) throw notFound("Payment");
  if (payment.status !== "unmatched") {
    throw new DomainError(
      "PAYMENT_NOT_UNMATCHED",
      `Payment is ${payment.status} — only unmatched payments can be manually matched`,
      409,
    );
  }

  const notice = await ctx.db.query.levyNotices.findFirst({
    where: and(eq(levyNotices.id, levyNoticeId), eq(levyNotices.schemeId, schemeId)),
  });
  if (!notice) throw notFound("Levy notice");
  if (!(OPEN_NOTICE_STATUSES as readonly string[]).includes(notice.status)) {
    throw new DomainError(
      "NOTICE_NOT_OPEN",
      `Notice ${notice.noticeNumber} is ${notice.status} — it no longer accepts payments`,
      422,
    );
  }

  const result = await ctx.db.transaction(async (tx) => {
    const applied = await applyPaymentToNotice(
      ctx,
      tx,
      payment,
      notice.id,
      payment.paidAt,
      "manual",
    );
    return {
      paymentId: payment.id,
      matched: true,
      levyNoticeId: applied.levyNoticeId,
      receiptNumber: applied.receiptNumber,
    } as RecordPaymentResult;
  });

  await sendReceiptEmail(ctx, schemeId, result).catch((err) =>
    console.error("[payments] receipt email failed", err),
  );
  return result;
}

async function openNoticesForScheme(tx: DbHandle, schemeId: string): Promise<OpenNotice[]> {
  const notices = await tx.query.levyNotices.findMany({
    where: and(
      eq(levyNotices.schemeId, schemeId),
      inArray(levyNotices.status, [...OPEN_NOTICE_STATUSES]),
    ),
  });
  if (notices.length === 0) return [];
  const allocations = await tx.query.paymentAllocations.findMany({
    where: inArray(
      paymentAllocations.levyNoticeId,
      notices.map((n) => n.id),
    ),
  });
  return notices.map((n) => ({
    levyNoticeId: n.id,
    payid: n.payid,
    outstandingCents:
      n.totalCents -
      allocations.filter((a) => a.levyNoticeId === n.id).reduce((s, a) => s + a.amountCents, 0),
  }));
}

/** References of settled notices — guards the matcher's amount heuristic. */
async function settledPayidsForScheme(tx: DbHandle, schemeId: string): Promise<string[]> {
  const rows = await tx.query.levyNotices.findMany({
    where: and(
      eq(levyNotices.schemeId, schemeId),
      inArray(levyNotices.status, [...SETTLED_NOTICE_STATUSES]),
    ),
    columns: { payid: true },
  });
  return rows.map((r) => r.payid).filter((p): p is string => p != null);
}

async function sendReceiptEmail(
  ctx: ServiceContext,
  schemeId: string,
  result: RecordPaymentResult,
) {
  const notice = await ctx.db.query.levyNotices.findFirst({
    where: eq(levyNotices.id, result.levyNoticeId!),
  });
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!notice || !scheme) return;
  const payment = await ctx.db.query.payments.findFirst({
    where: eq(payments.id, result.paymentId),
  });
  const { levyRecipientEmail } = await import("./arrears.js").then((m) => ({
    levyRecipientEmail: m.levyRecipient,
  }));
  const recipient = await levyRecipientEmail(ctx, schemeId, notice.lotId);
  if (!recipient?.email) return;

  await sendEmail(ctx, {
    schemeId,
    personId: recipient.personId,
    to: recipient.email,
    subject: `Receipt ${result.receiptNumber} — ${scheme.name}`,
    template: "receipt",
    related: { type: "payment", id: result.paymentId },
    body: [
      `Dear ${recipient.name ?? "Owner"},`,
      "",
      `We received your payment of ${formatCents(payment?.amountCents ?? 0)} for levy notice ${notice.noticeNumber}.`,
      `The notice is now ${notice.status === "paid" ? "fully paid — thank you" : "partially paid"}.`,
      "",
      `Receipt number: ${result.receiptNumber}`,
      "",
      "Regards,",
      `${scheme.name} — powered by GoodStrata`,
    ].join("\n"),
  });
}

/** Payment history for a scheme, enriched with receipt + allocation context. */
export async function listPayments(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.payments.findMany({
    where: eq(payments.schemeId, schemeId),
    orderBy: (t, { desc: d }) => d(t.paidAt),
  });
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);
  const [receiptRows, allocationRows] = await Promise.all([
    ctx.db.query.receipts.findMany({ where: inArray(receipts.paymentId, ids) }),
    ctx.db.query.paymentAllocations.findMany({
      where: inArray(paymentAllocations.paymentId, ids),
    }),
  ]);
  const noticeIds = [...new Set(allocationRows.map((a) => a.levyNoticeId))];
  const noticeRows = noticeIds.length
    ? await ctx.db.query.levyNotices.findMany({ where: inArray(levyNotices.id, noticeIds) })
    : [];

  return rows.map((p) => {
    const alloc = allocationRows.find((a) => a.paymentId === p.id);
    const notice = alloc ? noticeRows.find((n) => n.id === alloc.levyNoticeId) : undefined;
    const receipt = receiptRows.find((r) => r.paymentId === p.id);
    return {
      id: p.id,
      provider: p.provider,
      providerRef: p.providerRef,
      payid: p.payid,
      amountCents: p.amountCents,
      paidAt: p.paidAt,
      payerName: p.payerName,
      status: p.status,
      createdAt: p.createdAt,
      receiptNumber: receipt?.receiptNumber ?? null,
      levyNoticeId: notice?.id ?? null,
      noticeNumber: notice?.noticeNumber ?? null,
      lotId: notice?.lotId ?? null,
    };
  });
}

export interface PaymentsStatus {
  /** Which provider is live for this deployment (mock | monoova | …). */
  provider: string;
  /** The scheme's own collection account — how owners actually pay. */
  trustAccount: {
    status: string;
    bsb: string | null;
    accountNumber: string | null;
    payidRoot: string | null;
    provider: string;
  } | null;
  /** Parked payments awaiting a treasurer's attention. */
  unmatchedCount: number;
  lastPaymentAt: string | null;
  /** Last webhook delivery seen from the live provider (platform-wide). */
  webhookLastSeenAt: string | null;
  /** Verified webhook deliveries that never finished processing (platform-wide). */
  unprocessedWebhooks: number;
}

/**
 * Small payments observability surface: which provider is live, how owners
 * pay, webhook liveness, and the size of the suspense queue.
 */
export async function paymentsStatus(
  ctx: ServiceContext,
  schemeId: string,
): Promise<PaymentsStatus> {
  const providerName = ctx.integrations.payments.name;
  const account = await getSchemeTrustAccount(ctx, schemeId);

  const [unmatchedRows, lastPayment, lastWebhook, unprocessedRows] = await Promise.all([
    ctx.db
      .select({ count: sql<string>`count(*)` })
      .from(payments)
      .where(and(eq(payments.schemeId, schemeId), eq(payments.status, "unmatched"))),
    ctx.db.query.payments.findFirst({
      where: eq(payments.schemeId, schemeId),
      orderBy: desc(payments.paidAt),
    }),
    ctx.db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.provider, providerName),
      orderBy: desc(webhookEvents.receivedAt),
    }),
    ctx.db
      .select({ count: sql<string>`count(*)` })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, providerName),
          eq(webhookEvents.signatureValid, true),
          isNull(webhookEvents.processedAt),
        ),
      ),
  ]);

  return {
    provider: providerName,
    trustAccount: account
      ? {
          status: account.status,
          bsb: account.bsb,
          accountNumber: account.accountNumber,
          payidRoot: account.payidRoot,
          provider: account.provider,
        }
      : null,
    unmatchedCount: Number(unmatchedRows[0]?.count ?? 0),
    lastPaymentAt: lastPayment?.paidAt.toISOString() ?? null,
    webhookLastSeenAt: lastWebhook?.receivedAt.toISOString() ?? null,
    unprocessedWebhooks: Number(unprocessedRows[0]?.count ?? 0),
  };
}
