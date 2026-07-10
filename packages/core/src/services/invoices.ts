/**
 * Accounts payable — supplier invoices and payouts.
 *
 * Money never leaves an owners corporation without a human saying yes:
 * recording an invoice ALWAYS opens a treasurer-tier decision
 * (kind `invoice_approval`); the approval executor below — code, never an
 * LLM — flips the invoice to approved and queues the payout. Execution is a
 * manual/recorded rail (no bank API in this build): a treasurer records that
 * the transfer was made (bank reference + date), which settles the payout,
 * marks the invoice paid, and posts the `invoice_payment` outflow to the
 * fund ledger so the s 122 trust reconciliation's cash-out side balances.
 *
 * Status lifecycle driven here (per INVOICE_STATUSES):
 *   received → pending_approval → approved → paid
 * `disputed` is the treasurer's decline path; `matched`/`scheduled` are
 * reserved for a future OCR/scheduling rail.
 */
import {
  contractors,
  funds,
  fundTransactions,
  invoices,
  payouts,
  workOrders,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { addDays, formatCents, fromDateOnly } from "@goodstrata/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { registerDecisionAction, requestDecision } from "./decisions.js";

export const recordInvoiceInput = z
  .object({
    supplierName: z.string().trim().min(1).max(200),
    abn: z.string().trim().min(1).max(20).optional(),
    invoiceNumber: z.string().trim().min(1).max(100),
    /** Total payable in integer cents, GST inclusive. */
    amountCents: z.number().int().positive(),
    /** GST component of amountCents (0 for GST-free suppliers). */
    gstCents: z.number().int().min(0).default(0),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Which fund pays: admin (default) or maintenance (capital works). */
    fundKind: z.enum(["admin", "maintenance"]).default("admin"),
    contractorId: z.string().optional(),
    /** Link to the work order this invoice bills, when there is one. */
    workOrderId: z.string().optional(),
    documentId: z.string().optional(),
  })
  .refine((v) => v.gstCents <= v.amountCents, {
    message: "gstCents cannot exceed amountCents",
    path: ["gstCents"],
  });
export type RecordInvoiceInput = z.infer<typeof recordInvoiceInput>;

export interface RecordInvoiceResult {
  invoiceId: string;
  status: string;
  /** The treasurer-tier approval gate opened for this invoice. */
  decisionId: string;
}

/**
 * Record a supplier invoice and open the human approval gate. The invoice
 * lands as `received`, the `invoice.received` event is published, and a
 * treasurer-tier decision of kind `invoice_approval` is opened whose ONLY
 * follow-up path is the code executor below — there is no direct approve API.
 */
export async function recordInvoice(
  ctx: ServiceContext,
  schemeId: string,
  input: RecordInvoiceInput,
): Promise<RecordInvoiceResult> {
  // Validate soft links inside this scheme before any write: a foreign
  // scheme's work order or contractor must never be billable here.
  let workOrderLine = "";
  if (input.workOrderId) {
    const wo = await ctx.db.query.workOrders.findFirst({
      where: and(eq(workOrders.id, input.workOrderId), eq(workOrders.schemeId, schemeId)),
    });
    if (!wo) throw notFound("Work order");
    const scope = wo.scope.length > 100 ? `${wo.scope.slice(0, 100)}…` : wo.scope;
    workOrderLine = `\n- **Work order:** ${scope} (approved ${formatCents(wo.approvedAmountCents)})`;
  }
  if (input.contractorId) {
    const contractor = await ctx.db.query.contractors.findFirst({
      where: and(eq(contractors.id, input.contractorId), eq(contractors.schemeId, schemeId)),
    });
    if (!contractor) throw notFound("Contractor");
  }

  const invoice = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(invoices)
      .values({
        schemeId,
        contractorId: input.contractorId ?? null,
        supplierName: input.supplierName,
        abn: input.abn ?? null,
        invoiceNumber: input.invoiceNumber,
        amountCents: input.amountCents,
        gstCents: input.gstCents,
        dueOn: input.dueOn ?? null,
        status: "received",
        workOrderId: input.workOrderId ?? null,
        documentId: input.documentId ?? null,
        fundKind: input.fundKind,
      })
      .returning();
    const created = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `invoice:${created.id}`,
      type: "invoice.received",
      payload: {
        invoiceId: created.id,
        supplierName: created.supplierName,
        invoiceNumber: created.invoiceNumber,
        amountCents: created.amountCents,
        gstCents: created.gstCents,
        fundKind: created.fundKind,
        workOrderId: created.workOrderId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return created;
  });

  // Every invoice goes through the human gate — no auto-pay threshold.
  const decision = await requestDecision(ctx, {
    schemeId,
    kind: "invoice_approval",
    title: `Approve invoice: ${invoice.supplierName} ${invoice.invoiceNumber} — ${formatCents(invoice.amountCents)}`,
    summaryMd: [
      `- **Supplier:** ${invoice.supplierName}${invoice.abn ? ` (ABN ${invoice.abn})` : ""}`,
      `- **Invoice number:** ${invoice.invoiceNumber}`,
      `- **Amount:** ${formatCents(invoice.amountCents)} (incl. ${formatCents(invoice.gstCents)} GST)`,
      `- **Pays from:** ${invoice.fundKind === "maintenance" ? "maintenance (capital works) fund" : "admin fund"}`,
      `- **Due:** ${invoice.dueOn ?? "—"}${workOrderLine}`,
      "",
      "On approval, a payout is queued for the treasurer to execute and record against the trust account.",
    ].join("\n"),
    subject: { type: "invoice", id: invoice.id },
    deciderRole: "treasurer",
    dueAt: addDays(ctx.clock.now(), 7),
    followUp: {
      type: "action",
      action: "finance.approveInvoice",
      args: { invoiceId: invoice.id },
    },
    requestedByRunId: ctx.actor.kind === "agent" ? ctx.actor.agentRunId : undefined,
  });

  await ctx.db
    .update(invoices)
    .set({ status: "pending_approval", decisionId: decision.id })
    .where(eq(invoices.id, invoice.id));

  return { invoiceId: invoice.id, status: "pending_approval", decisionId: decision.id };
}

/**
 * NOT exported. The only caller is the decision follow-up executor below —
 * approving an invoice without a resolved treasurer decision is impossible
 * through this service's API. Idempotent: a retried executor sees the invoice
 * already past `pending_approval` and does nothing.
 */
async function approveInvoiceAndQueuePayout(
  ctx: ServiceContext,
  schemeId: string,
  invoiceId: string,
  decisionId: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    // Compare-and-set: only a pending invoice may flip to approved. A retried
    // executor (or a duplicate decision.resolved delivery) loses the race and
    // exits without queueing a second payout.
    const flipped = await tx
      .update(invoices)
      .set({ status: "approved", decisionId })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.schemeId, schemeId),
          eq(invoices.status, "pending_approval"),
        ),
      )
      .returning();
    const invoice = flipped[0];
    if (!invoice) return;

    const payoutRows = await tx
      .insert(payouts)
      .values({
        schemeId,
        invoiceId: invoice.id,
        provider: "manual",
        amountCents: invoice.amountCents,
        status: "queued",
      })
      .returning();

    await publishEvent(tx, {
      schemeId,
      stream: `invoice:${invoice.id}`,
      type: "invoice.approved",
      payload: {
        invoiceId: invoice.id,
        decisionId,
        payoutId: payoutRows[0]!.id,
        amountCents: invoice.amountCents,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
}

// Executor: the treasurer said yes — approve the invoice and queue its payout.
// This registration is the ONLY path into approveInvoiceAndQueuePayout.
registerDecisionAction("finance.approveInvoice", async (ctx, args, decision) => {
  const { invoiceId } = z.object({ invoiceId: z.string() }).parse(args);
  await approveInvoiceAndQueuePayout(ctx, decision.schemeId, invoiceId, decision.id);
});

export const executePayoutInput = z.object({
  /** Bank transfer reference — the audit link back to the statement line. */
  reference: z.string().trim().min(1).max(120),
  /** Date the money left the trust account. */
  executedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ExecutePayoutInput = z.infer<typeof executePayoutInput>;

export interface ExecutePayoutResult {
  payoutId: string;
  invoiceId: string;
  status: string;
  amountCents: number;
}

/**
 * Manual payout rail (no bank API in this build): a treasurer records that the
 * approved transfer was actually made. Settles the payout with the bank
 * reference and date, marks the invoice paid, and posts the signed
 * `invoice_payment` outflow to the invoice's fund — the ledger and the
 * payout (cash) side of the trust reconciliation move together, atomically.
 */
export async function executePayout(
  ctx: ServiceContext,
  schemeId: string,
  payoutId: string,
  input: ExecutePayoutInput,
): Promise<ExecutePayoutResult> {
  const payout = await ctx.db.query.payouts.findFirst({
    where: and(eq(payouts.id, payoutId), eq(payouts.schemeId, schemeId)),
  });
  if (!payout) throw notFound("Payout");

  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(invoices.id, payout.invoiceId), eq(invoices.schemeId, schemeId)),
  });
  if (!invoice) throw notFound("Invoice");

  const executedAt = fromDateOnly(input.executedAt);

  return await ctx.db.transaction(async (tx) => {
    // Compare-and-set: only a queued payout may settle. A double-click or a
    // second treasurer serializes on the row lock — the loser sees 0 rows and
    // rolls back instead of double-debiting the fund.
    const flipped = await tx
      .update(payouts)
      .set({ status: "settled", providerRef: input.reference, executedAt })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, "queued")))
      .returning();
    if (flipped.length === 0) {
      throw new DomainError(
        "PAYOUT_ALREADY_EXECUTED",
        `Payout is ${payout.status} — only a queued payout can be executed`,
        409,
      );
    }

    await tx.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoice.id));

    // Fund attribution: the outflow debits the fund the invoice bills. A
    // missing fund would silently drop the ledger leg and break the s 122
    // reconciliation — fail loudly instead.
    const fund = await tx.query.funds.findFirst({
      where: and(eq(funds.schemeId, schemeId), eq(funds.kind, invoice.fundKind)),
    });
    if (!fund) {
      throw new DomainError(
        "FUND_NOT_PROVISIONED",
        `No ${invoice.fundKind} fund exists for this scheme — cannot post the payment`,
        422,
      );
    }
    await tx.insert(fundTransactions).values({
      schemeId,
      fundId: fund.id,
      amountCents: -payout.amountCents,
      kind: "invoice_payment",
      reference: { payoutId, invoiceId: invoice.id },
      occurredAt: executedAt,
    });
    await tx
      .update(funds)
      .set({ balanceCents: sql`${funds.balanceCents} - ${payout.amountCents}` })
      .where(eq(funds.id, fund.id));

    await publishEvent(tx, {
      schemeId,
      stream: `invoice:${invoice.id}`,
      type: "payout.executed",
      payload: {
        payoutId,
        invoiceId: invoice.id,
        amountCents: payout.amountCents,
        provider: payout.provider,
        providerRef: input.reference,
        fundKind: invoice.fundKind,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return {
      payoutId,
      invoiceId: invoice.id,
      status: "settled",
      amountCents: payout.amountCents,
    };
  });
}

/** Invoice history for a scheme, enriched with its payout state. */
export async function listInvoices(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.invoices.findMany({
    where: eq(invoices.schemeId, schemeId),
    orderBy: desc(invoices.createdAt),
  });
  if (rows.length === 0) return [];

  const payoutRows = await ctx.db.query.payouts.findMany({
    where: inArray(
      payouts.invoiceId,
      rows.map((i) => i.id),
    ),
  });

  return rows.map((invoice) => {
    const payout = payoutRows.find((p) => p.invoiceId === invoice.id);
    return {
      ...invoice,
      payout: payout
        ? {
            id: payout.id,
            status: payout.status,
            providerRef: payout.providerRef,
            amountCents: payout.amountCents,
            executedAt: payout.executedAt,
          }
        : null,
    };
  });
}

export async function getInvoice(ctx: ServiceContext, schemeId: string, invoiceId: string) {
  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.schemeId, schemeId)),
  });
  if (!invoice) throw notFound("Invoice");
  const payoutRows = await ctx.db.query.payouts.findMany({
    where: eq(payouts.invoiceId, invoiceId),
    orderBy: desc(payouts.createdAt),
  });
  return { invoice, payouts: payoutRows };
}

/** Payouts for a scheme — the cash-out side of the trust reconciliation. */
export async function listPayouts(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.payouts.findMany({
    where: eq(payouts.schemeId, schemeId),
    orderBy: desc(payouts.createdAt),
  });
  if (rows.length === 0) return [];

  const invoiceRows = await ctx.db.query.invoices.findMany({
    where: inArray(
      invoices.id,
      rows.map((p) => p.invoiceId),
    ),
    columns: { id: true, supplierName: true, invoiceNumber: true, fundKind: true },
  });
  const byId = new Map(invoiceRows.map((i) => [i.id, i]));

  return rows.map((p) => ({
    ...p,
    supplierName: byId.get(p.invoiceId)?.supplierName ?? null,
    invoiceNumber: byId.get(p.invoiceId)?.invoiceNumber ?? null,
    fundKind: byId.get(p.invoiceId)?.fundKind ?? null,
  }));
}
