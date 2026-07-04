import {
  budgetLines,
  budgets,
  funds,
  fundTransactions,
  levySchedules,
  lots,
  ownerships,
  payments,
  people,
  schemes,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, type Clock, fixedClock, systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as leviesService from "../src/services/levies.js";
import * as paymentsService from "../src/services/payments.js";
import * as trustAccountsService from "../src/services/trustAccounts.js";
import * as trustReconciliationService from "../src/services/trustReconciliation.js";

let tdb: TestDatabase;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

interface Seeded {
  schemeId: string;
  scheduleId: string;
}

/** A minimal but complete scheme: adopted budget, one lot+owner, a levy schedule. */
async function seedScheme(name: string, plan: string, adminCents: number): Promise<Seeded> {
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name,
      planOfSubdivision: plan,
      addressLine1: "1 Test St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  const schemeId = schemeRows[0]!.id;

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
    .values({ schemeId, givenName: "Pat", familyName: "Owner", email: `pat-${plan}@example.com` })
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
    amountCents: adminCents,
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

  return { schemeId, scheduleId: scheduleRows[0]!.id };
}

/** Drive the real inbound-payment pipeline so ledger + cash stay consistent. */
async function payNotice(ctx: ServiceContext, payid: string, amountCents: number, paidAt: string) {
  const provider = integrations.payments;
  const body = provider.buildWebhookBody({ payid, amountCents, paidAt, payerName: "Pat Owner" });
  return paymentsService.recordInboundPayment(ctx, "mock", provider.parseWebhook(body));
}

let a: Seeded;
let b: Seeded;

// Distinct annual budgets → distinct instalment amounts, so any cross-scheme
// leakage would show up as a wrong total rather than a coincidental match.
beforeAll(async () => {
  tdb = await provisionTestDatabase();
  a = await seedScheme("Recon OC A", "PS200001A", 4_000_000);
  b = await seedScheme("Recon OC B", "PS200002B", 6_000_000);

  const ctx = ctxAt("2026-06-01T00:00:00Z");
  await trustAccountsService.ensureSchemeTrustAccount(ctx, a.schemeId);
  await trustAccountsService.ensureSchemeTrustAccount(ctx, b.schemeId);
  await leviesService.issueLevyRun(ctx, a.schemeId, a.scheduleId, 1);
  await leviesService.issueLevyRun(ctx, b.schemeId, b.scheduleId, 1);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("per-OC trust reconciliation (OC Act s 122)", () => {
  it("reconciles a scheme's statement to its own ledger and excludes other schemes", async () => {
    const ctx = ctxAt("2026-06-05T00:00:00Z");

    const noticeA = (await leviesService.listNotices(ctx, a.schemeId))[0]!;
    const noticeB = (await leviesService.listNotices(ctx, b.schemeId))[0]!;
    expect(noticeA.totalCents).not.toBe(noticeB.totalCents); // distinct amounts

    await payNotice(ctx, noticeA.payid!, noticeA.totalCents, "2026-06-05T00:00:00Z");
    await payNotice(ctx, noticeB.payid!, noticeB.totalCents, "2026-06-05T00:00:00Z");

    const stmtA = await trustReconciliationService.schemeTrustStatement(ctx, a.schemeId);
    const stmtB = await trustReconciliationService.schemeTrustStatement(ctx, b.schemeId);

    // Independent ledger derivation for scheme A (source of truth).
    const ledgerA = await tdb.db.query.fundTransactions.findMany({
      where: eq(fundTransactions.schemeId, a.schemeId),
    });
    const ledgerSumA = ledgerA.reduce((s, t) => s + t.amountCents, 0);

    // Statement closing balance equals the scheme's own ledger — and ONLY its own.
    expect(stmtA.closingBalanceCents).toBe(ledgerSumA);
    expect(stmtA.closingBalanceCents).toBe(noticeA.totalCents);
    expect(stmtA.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(noticeA.totalCents);

    // No leakage from B: A's totals are A's alone (a leak would inflate them).
    expect(stmtA.closingBalanceCents).not.toBe(noticeB.totalCents);
    expect(stmtB.closingBalanceCents).toBe(noticeB.totalCents);

    // Cash matches the books ⇒ reconciled, zero variance, on the OC's own account.
    expect(stmtA.reconciled).toBe(true);
    expect(stmtA.varianceCents).toBe(0);
    expect(stmtA.bankBalanceCents).toBe(noticeA.totalCents);
    expect(stmtA.bankAccountId).not.toBeNull();
    expect(stmtA.schemeId).toBe(a.schemeId);
  });

  it("flags a variance when trust cash is unbooked against the ledger", async () => {
    const ctx = ctxAt("2026-06-06T00:00:00Z");

    // Cash lands in the OC's trust account but is never matched to a fund — a
    // suspense item an auditor must see. Bank side rises; ledger does not.
    await tdb.db.insert(payments).values({
      schemeId: a.schemeId,
      provider: "manual",
      providerRef: "UNMATCHED-001",
      amountCents: 12_345,
      paidAt: new Date("2026-06-06T00:00:00Z"),
      payerName: "Anonymous",
      status: "unmatched",
    });

    const stmtA = await trustReconciliationService.schemeTrustStatement(ctx, a.schemeId);

    expect(stmtA.reconciled).toBe(false);
    expect(stmtA.varianceCents).toBe(12_345);
    expect(stmtA.bankBalanceCents).toBe(stmtA.closingBalanceCents + 12_345);
  });

  it("clears the variance once the parked payment is manually matched", async () => {
    const ctx = ctxAt("2026-06-08T00:00:00Z");

    // Give A an open notice to absorb the suspense item, then resolve it via
    // the treasurer's manual-match rail (the same allocation/receipt chain).
    await leviesService.issueLevyRun(ctx, a.schemeId, a.scheduleId, 2);
    const inst2 = (await leviesService.listNotices(ctx, a.schemeId)).find(
      (n) => n.instalment === 2,
    )!;
    const parked = await tdb.db.query.payments.findFirst({
      where: eq(payments.providerRef, "UNMATCHED-001"),
    });
    await paymentsService.matchPaymentToNotice(ctx, a.schemeId, parked!.id, inst2.id);

    // Ledger caught up with the cash: bank and books agree again.
    const stmtA = await trustReconciliationService.schemeTrustStatement(ctx, a.schemeId);
    expect(stmtA.reconciled).toBe(true);
    expect(stmtA.varianceCents).toBe(0);
  });

  it("produces a CSV audit export scoped to the scheme", async () => {
    const ctx = ctxAt("2026-06-07T00:00:00Z");
    const pack = await trustReconciliationService.exportTrustAudit(ctx, a.schemeId);

    expect(pack.filename).toContain(a.schemeId);
    expect(pack.csv).toContain("trust account audit export");
    expect(pack.csv).toContain("Recon OC A");
    expect(pack.csv).not.toContain("Recon OC B");
    // Header block + a movements table with at least the reconciled receipt.
    expect(pack.csv).toContain("Date,Kind,Description,Amount,Balance");
    expect(pack.statement.schemeId).toBe(a.schemeId);
  });
});
