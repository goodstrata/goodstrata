import {
  funds,
  fundTransactions,
  levyNoticeLines,
  levyNotices,
  lotLedgerEntries,
  paymentAllocations,
  payments,
  receipts,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import type { InboundPayment } from "@goodstrata/integrations";
import { allocateByWeight, formatCents, toDateOnly } from "@goodstrata/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { matchPayment, type OpenNotice } from "../engines/reconcile.js";
import { sendEmail } from "./comms.js";
import { trustAccountForInboundPayment } from "./trustAccounts.js";

export interface RecordPaymentResult {
  paymentId: string;
  matched: boolean;
  levyNoticeId?: string;
  receiptNumber?: string;
  duplicate?: boolean;
}

/**
 * Record an inbound payment (from a provider webhook) and reconcile it:
 * allocate to the matched notice, post the lot ledger credit, split the
 * receipt across funds pro-rata, and issue + email a receipt. Idempotent on
 * (provider, providerRef).
 */
export async function recordInboundPayment(
  ctx: ServiceContext,
  provider: string,
  inbound: InboundPayment,
): Promise<RecordPaymentResult> {
  // Resolve the scheme via the payment reference.
  const noticeByRef = inbound.payid
    ? await ctx.db.query.levyNotices.findFirst({
        where: eq(levyNotices.payid, inbound.payid),
      })
    : undefined;
  if (!noticeByRef) {
    throw new Error(
      `payment ${inbound.providerRef}: cannot resolve scheme (unknown reference ${inbound.payid})`,
    );
  }
  const schemeId = noticeByRef.schemeId;

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
        paidAt: new Date(inbound.paidAt),
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

    const openNotices = await openNoticesForScheme(ctx, tx, schemeId);

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

    const match = matchPayment(
      { payid: payment.payid, amountCents: payment.amountCents },
      openNotices,
    );

    if (match.kind === "unmatched") {
      await tx.update(payments).set({ status: "unmatched" }).where(eq(payments.id, payment.id));
      await publishEvent(tx, {
        schemeId,
        stream: `payment:${payment.id}`,
        type: "payment.unmatched",
        payload: { paymentId: payment.id, reason: match.reason },
        actor: ctx.actor,
        ...causationFields(ctx),
      });
      return { paymentId: payment.id, matched: false } as RecordPaymentResult;
    }

    const notice = await tx.query.levyNotices.findFirst({
      where: eq(levyNotices.id, match.levyNoticeId),
    });
    if (!notice) throw new Error("matched notice vanished");

    await tx.insert(paymentAllocations).values({
      paymentId: payment.id,
      levyNoticeId: notice.id,
      amountCents: payment.amountCents,
    });

    // Lot ledger credit (payments are negative).
    await tx.insert(lotLedgerEntries).values({
      schemeId,
      lotId: notice.lotId,
      kind: "payment",
      amountCents: -payment.amountCents,
      levyNoticeId: notice.id,
      paymentId: payment.id,
      effectiveOn: toDateOnly(new Date(inbound.paidAt)),
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
          occurredAt: new Date(inbound.paidAt),
        });
        await tx
          .update(funds)
          .set({ balanceCents: sql`${funds.balanceCents} + ${share}` })
          .where(eq(funds.id, fund.id));
      }
    }

    await tx.update(payments).set({ status: "matched" }).where(eq(payments.id, payment.id));
    await publishEvent(tx, {
      schemeId,
      stream: `payment:${payment.id}`,
      type: "payment.matched",
      payload: {
        paymentId: payment.id,
        levyNoticeId: notice.id,
        via: match.via,
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

    return {
      paymentId: payment.id,
      matched: true,
      levyNoticeId: notice.id,
      receiptNumber,
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

async function openNoticesForScheme(
  _ctx: ServiceContext,
  tx: Parameters<Parameters<ServiceContext["db"]["transaction"]>[0]>[0],
  schemeId: string,
): Promise<OpenNotice[]> {
  const notices = await tx.query.levyNotices.findMany({
    where: and(
      eq(levyNotices.schemeId, schemeId),
      inArray(levyNotices.status, ["issued", "partially_paid", "overdue"]),
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

export async function listPayments(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.payments.findMany({
    where: eq(payments.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.paidAt),
  });
}
