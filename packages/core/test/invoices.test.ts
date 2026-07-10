import {
  budgetLines,
  budgets,
  funds,
  fundTransactions,
  levySchedules,
  lots,
  memberships,
  ownerships,
  payouts,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, type Clock, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as invoicesService from "../src/services/invoices.js";
import * as leviesService from "../src/services/levies.js";
import * as paymentsService from "../src/services/payments.js";
import * as trustAccountsService from "../src/services/trustAccounts.js";
import * as trustReconciliationService from "../src/services/trustReconciliation.js";

let tdb: TestDatabase;
let schemeId: string;
let scheduleId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const TREASURER = "user-ap-treasurer";

function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Payable OC",
      planOfSubdivision: "PS300001P",
      addressLine1: "1 Supplier St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(funds).values([
    { schemeId, kind: "admin", name: "Admin" },
    { schemeId, kind: "maintenance", name: "Maintenance" },
  ]);

  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 })
    .returning();
  const personRows = await tdb.db
    .insert(people)
    .values({ schemeId, givenName: "Pat", familyName: "Owner", email: "pat-ap@example.com" })
    .returning();
  await tdb.db.insert(ownerships).values({
    schemeId,
    lotId: lotRows[0]!.id,
    personId: personRows[0]!.id,
    startedOn: "2020-01-01",
  });

  const budgetRows = await tdb.db
    .insert(budgets)
    .values({ schemeId, fiscalYearStart: "2026-07-01", status: "adopted" })
    .returning();
  await tdb.db.insert(budgetLines).values({
    budgetId: budgetRows[0]!.id,
    fundKind: "admin",
    category: "General",
    amountCents: 4_000_000,
  });
  const scheduleRows = await tdb.db
    .insert(levySchedules)
    .values({
      schemeId,
      budgetId: budgetRows[0]!.id,
      frequency: "quarterly",
      instalments: 4,
      firstDueOn: "2026-07-01",
    })
    .returning();
  scheduleId = scheduleRows[0]!.id;

  await tdb.db
    .insert(users)
    .values({ id: TREASURER, name: "Terry Treasurer", email: "ap-treasurer@example.com" });
  await tdb.db
    .insert(memberships)
    .values({ schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" });

  const ctx = ctxAt("2026-06-01T00:00:00Z");
  await trustAccountsService.ensureSchemeTrustAccount(ctx, schemeId);
  await leviesService.issueLevyRun(ctx, schemeId, scheduleId, 1);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

/** Drive the real inbound-payment pipeline so the trust cash side is genuine. */
async function payNotice(ctx: ServiceContext, payid: string, amountCents: number, paidAt: string) {
  const provider = integrations.payments;
  const body = provider.buildWebhookBody({ payid, amountCents, paidAt, payerName: "Pat Owner" });
  return paymentsService.recordInboundPayment(ctx, "mock", provider.parseWebhook(body));
}

describe("accounts payable — supplier invoices through the human gate to payout", () => {
  let invoiceId: string;
  let decisionId: string;
  let payoutId: string;
  let noticeTotal: number;

  it("records an invoice, publishes invoice.received, and opens a treasurer decision", async () => {
    const ctx = ctxAt("2026-06-10T00:00:00Z");

    const result = await invoicesService.recordInvoice(ctx, schemeId, {
      supplierName: "Fitzroy Plumbing Co",
      abn: "12 345 678 901",
      invoiceNumber: "INV-1001",
      amountCents: 550_000,
      gstCents: 50_000,
      dueOn: "2026-06-30",
      fundKind: "admin",
    });
    invoiceId = result.invoiceId;
    decisionId = result.decisionId;

    expect(result.status).toBe("pending_approval");

    const { invoice } = await invoicesService.getInvoice(ctx, schemeId, invoiceId);
    expect(invoice).toMatchObject({
      status: "pending_approval",
      decisionId,
      supplierName: "Fitzroy Plumbing Co",
      amountCents: 550_000,
      gstCents: 50_000,
      fundKind: "admin",
    });

    const received = await tdb.db.query.eventLog.findMany({
      where: (t, { and: a, eq: e }) =>
        a(e(t.type, "invoice.received"), e(t.stream, `invoice:${invoiceId}`)),
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toMatchObject({ invoiceId, amountCents: 550_000 });

    const pending = await decisionsService.listDecisions(ctx, schemeId, "pending");
    const gate = pending.find((d) => d.id === decisionId);
    expect(gate).toMatchObject({ kind: "invoice_approval", deciderRole: "treasurer" });
    expect(gate?.subject).toMatchObject({ type: "invoice", id: invoiceId });
  });

  it("approval executor (code-only) marks the invoice approved and queues the payout", async () => {
    const ctx = ctxAt("2026-06-11T00:00:00Z", userActor(TREASURER));

    const resolved = await decisionsService.resolveDecision(ctx, schemeId, decisionId, "approve", [
      "treasurer",
    ]);
    expect(resolved.status).toBe("approved");

    // Same code path the decision.execute worker runs.
    const execCtx = ctxAt("2026-06-11T00:00:00Z", systemActor("decision-executor"));
    const { executed } = await decisionsService.executeDecisionFollowUp(execCtx, decisionId);
    expect(executed).toBe("finance.approveInvoice");

    const { invoice, payouts: rows } = await invoicesService.getInvoice(
      ctxAt("2026-06-11T00:00:00Z"),
      schemeId,
      invoiceId,
    );
    expect(invoice.status).toBe("approved");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", amountCents: 550_000, provider: "manual" });
    payoutId = rows[0]!.id;

    const approvedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { and: a, eq: e }) =>
        a(e(t.type, "invoice.approved"), e(t.stream, `invoice:${invoiceId}`)),
    });
    expect(approvedEvents).toHaveLength(1);
    expect(approvedEvents[0]!.payload).toMatchObject({ invoiceId, decisionId, payoutId });

    // A retried executor is a no-op: still exactly one payout.
    await decisionsService.executeDecisionFollowUp(execCtx, decisionId);
    const after = await tdb.db.query.payouts.findMany({
      where: eq(payouts.invoiceId, invoiceId),
    });
    expect(after).toHaveLength(1);
  });

  it("executing the payout settles it, pays the invoice, and posts the fund outflow", async () => {
    const ctx = ctxAt("2026-06-15T00:00:00Z", userActor(TREASURER));

    const result = await invoicesService.executePayout(ctx, schemeId, payoutId, {
      reference: "BANKREF-778899",
      executedAt: "2026-06-15",
    });
    expect(result).toMatchObject({
      payoutId,
      invoiceId,
      status: "settled",
      amountCents: 550_000,
    });

    const { invoice, payouts: rows } = await invoicesService.getInvoice(ctx, schemeId, invoiceId);
    expect(invoice.status).toBe("paid");
    expect(rows[0]).toMatchObject({ status: "settled", providerRef: "BANKREF-778899" });
    expect(rows[0]!.executedAt).not.toBeNull();

    // The ledger got the signed outflow, attributed to the invoice's fund.
    const outflows = await tdb.db.query.fundTransactions.findMany({
      where: and(
        eq(fundTransactions.schemeId, schemeId),
        eq(fundTransactions.kind, "invoice_payment"),
      ),
    });
    expect(outflows).toHaveLength(1);
    expect(outflows[0]!.amountCents).toBe(-550_000);
    expect(outflows[0]!.reference).toMatchObject({ payoutId, invoiceId });

    const adminFund = await tdb.db.query.funds.findFirst({
      where: and(eq(funds.schemeId, schemeId), eq(funds.kind, "admin")),
    });
    expect(adminFund!.balanceCents).toBe(-550_000); // no receipts booked yet in this test

    const executedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { and: a, eq: e }) =>
        a(e(t.type, "payout.executed"), e(t.stream, `invoice:${invoiceId}`)),
    });
    expect(executedEvents).toHaveLength(1);
    expect(executedEvents[0]!.payload).toMatchObject({
      payoutId,
      invoiceId,
      amountCents: 550_000,
      providerRef: "BANKREF-778899",
      fundKind: "admin",
    });
  });

  it("refuses to execute the same payout twice", async () => {
    const ctx = ctxAt("2026-06-16T00:00:00Z", userActor(TREASURER));
    await expect(
      invoicesService.executePayout(ctx, schemeId, payoutId, {
        reference: "BANKREF-DUPLICATE",
        executedAt: "2026-06-16",
      }),
    ).rejects.toThrow(/only a queued payout/i);
  });

  it("trust reconciliation balances with the payout on the cash-out side", async () => {
    const ctx = ctxAt("2026-06-20T00:00:00Z");

    // Money in through the real pipeline: the levy receipt books ledger + cash
    // together, exactly as production does.
    const notice = (await leviesService.listNotices(ctx, schemeId))[0]!;
    noticeTotal = notice.totalCents;
    await payNotice(ctx, notice.payid!, notice.totalCents, "2026-06-20T00:00:00Z");

    const stmt = await trustReconciliationService.schemeTrustStatement(ctx, schemeId);

    // Bank side = receipts in − payout out; ledger side carries the same two
    // legs (levy_receipt + invoice_payment) ⇒ zero variance.
    expect(stmt.bankBalanceCents).toBe(noticeTotal - 550_000);
    expect(stmt.closingBalanceCents).toBe(noticeTotal - 550_000);
    expect(stmt.reconciled).toBe(true);
    expect(stmt.varianceCents).toBe(0);

    // The payout shows up as a movement line on the auditor's statement.
    const outLine = stmt.lines.find((l) => l.kind === "invoice_payment");
    expect(outLine).toBeDefined();
    expect(outLine!.amountCents).toBe(-550_000);
  });

  it("declined invoices never pay: the executor is a no-op and no payout exists", async () => {
    const ctx = ctxAt("2026-06-21T00:00:00Z", userActor(TREASURER));

    const { invoiceId: declinedId, decisionId: declinedDecisionId } =
      await invoicesService.recordInvoice(ctx, schemeId, {
        supplierName: "Overpriced Painting Pty Ltd",
        invoiceNumber: "INV-2002",
        amountCents: 9_900_000,
        gstCents: 900_000,
        fundKind: "maintenance",
      });

    await decisionsService.resolveDecision(ctx, schemeId, declinedDecisionId, "decline", [
      "treasurer",
    ]);
    const { executed } = await decisionsService.executeDecisionFollowUp(
      ctxAt("2026-06-21T00:00:00Z", systemActor("decision-executor")),
      declinedDecisionId,
    );
    expect(executed).toBeNull();

    const { invoice, payouts: rows } = await invoicesService.getInvoice(ctx, schemeId, declinedId);
    expect(invoice.status).toBe("pending_approval"); // never approved, never paid
    expect(rows).toHaveLength(0);
  });

  it("rejects an invoice linked to a work order outside the scheme", async () => {
    const ctx = ctxAt("2026-06-22T00:00:00Z", userActor(TREASURER));
    await expect(
      invoicesService.recordInvoice(ctx, schemeId, {
        supplierName: "Wrong Scheme Services",
        invoiceNumber: "INV-3003",
        amountCents: 100_000,
        gstCents: 0,
        fundKind: "admin",
        workOrderId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/work order/i);
  });

  it("lists invoices with payout state and payouts with supplier context", async () => {
    const ctx = ctxAt("2026-06-23T00:00:00Z");

    const invoiceRows = await invoicesService.listInvoices(ctx, schemeId);
    const paid = invoiceRows.find((i) => i.id === invoiceId);
    expect(paid).toMatchObject({ status: "paid" });
    expect(paid?.payout).toMatchObject({ status: "settled", providerRef: "BANKREF-778899" });

    const payoutRows = await invoicesService.listPayouts(ctx, schemeId);
    expect(payoutRows).toHaveLength(1);
    expect(payoutRows[0]).toMatchObject({
      invoiceId,
      supplierName: "Fitzroy Plumbing Co",
      invoiceNumber: "INV-1001",
      fundKind: "admin",
      status: "settled",
    });
  });
});
