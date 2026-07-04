import { randomUUID } from "node:crypto";
import { funds, lots, ownerships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, type Clock, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as arrearsService from "../src/services/arrears.js";
import * as budgetsService from "../src/services/budgets.js";
import * as decisionsService from "../src/services/decisions.js";
import * as leviesService from "../src/services/levies.js";
import * as paymentsService from "../src/services/payments.js";
import * as trustAccountsService from "../src/services/trustAccounts.js";
import "../src/services/recovery.js"; // registers the debt-recovery executor action

let tdb: TestDatabase;
let schemeId: string;
const lotIds: string[] = [];
const managerUserId = "user-manager-1";
const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

const T0 = "2026-06-01T00:00:00Z"; // issue date
function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  // Seed: an active scheme with 3 lots (shop double-weighted) and owners.
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Loop Test OC",
      planOfSubdivision: "PS777777L",
      addressLine1: "1 Test St",
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

  await tdb.db.insert(users).values({
    id: managerUserId,
    name: "Terry Treasurer",
    email: "terry@example.com",
  });

  const lotSpecs = [
    { lotNumber: "1", liability: 20, owner: ["Sam", "Shopkeeper", "sam@example.com"] },
    { lotNumber: "2", liability: 10, owner: ["Alex", "Owner", "alex@example.com"] },
    { lotNumber: "3", liability: 10, owner: ["Kim", "Nguyen", "kim@example.com"] },
  ];
  for (const spec of lotSpecs) {
    const lotRows = await tdb.db
      .insert(lots)
      .values({
        schemeId,
        lotNumber: spec.lotNumber,
        entitlement: spec.liability,
        liability: spec.liability,
      })
      .returning();
    lotIds.push(lotRows[0]!.id);
    const personRows = await tdb.db
      .insert(people)
      .values({
        schemeId,
        givenName: spec.owner[0],
        familyName: spec.owner[1],
        email: spec.owner[2],
      })
      .returning();
    await tdb.db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personRows[0]!.id,
      startedOn: "2020-01-01",
    });
  }
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("the money loop", () => {
  let budgetId: string;
  let scheduleId: string;

  it("drafts a budget and opens the treasurer decision gate", async () => {
    const ctx = ctxAt(T0, userActor(managerUserId));
    const budget = await budgetsService.createBudget(ctx, schemeId, {
      fiscalYearStart: "2026-07-01",
      adminCents: 4_800_000,
      maintenanceCents: 1_200_000,
    });
    budgetId = budget.id;

    const pending = await decisionsService.listDecisions(ctx, schemeId, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.kind).toBe("budget_adoption");

    // Levies cannot issue before adoption.
    await expect(
      leviesService.createLevySchedule(ctx, schemeId, {
        budgetId,
        frequency: "quarterly",
        firstDueOn: "2026-07-01",
      }),
    ).rejects.toThrow(/adopted/);
  });

  it("treasurer approval adopts the budget via the code executor", async () => {
    const ctx = ctxAt(T0, userActor(managerUserId));
    const pending = await decisionsService.listDecisions(ctx, schemeId, "pending");
    const resolved = await decisionsService.resolveDecision(
      ctx,
      schemeId,
      pending[0]!.id,
      "approve",
      ["treasurer"],
    );
    expect(resolved.status).toBe("approved");

    // In production the executor worker picks up decision.resolved; here we
    // invoke the same code path directly.
    const execCtx = ctxAt(T0, systemActor("decision-executor"));
    const { executed } = await decisionsService.executeDecisionFollowUp(execCtx, pending[0]!.id);
    expect(executed).toBe("finance.adoptBudget");

    const budgets = await budgetsService.listBudgets(ctx, schemeId);
    expect(budgets[0]!.status).toBe("adopted");
  });

  it("rejects a decision resolved by the wrong role", async () => {
    const ctx = ctxAt(T0, userActor(managerUserId));
    const budget = await budgetsService.createBudget(ctx, schemeId, {
      fiscalYearStart: "2027-07-01",
      adminCents: 100,
      maintenanceCents: 0,
    });
    const pending = (await decisionsService.listDecisions(ctx, schemeId, "pending")).find(
      (d) => (d.subject as { id: string }).id === budget.id,
    )!;
    await expect(
      decisionsService.resolveDecision(ctx, schemeId, pending.id, "approve", ["owner"]),
    ).rejects.toThrow(/treasurer/);
    // Clean up: approve it so it doesn't pollute later assertions.
    await decisionsService.resolveDecision(ctx, schemeId, pending.id, "decline", ["treasurer"]);
  });

  it("issues a levy run: notices, ledger charges, refs, and emails", async () => {
    const ctx = ctxAt(T0, userActor(managerUserId));
    const schedule = await leviesService.createLevySchedule(ctx, schemeId, {
      budgetId,
      frequency: "quarterly",
      firstDueOn: "2026-07-01",
    });
    scheduleId = schedule.id;

    memoryEmail.sent.length = 0;
    const result = await leviesService.issueLevyRun(ctx, schemeId, scheduleId, 1);
    expect(result.issued).toBe(3);
    expect(result.dueOn).toBe("2026-07-01");

    const notices = await leviesService.listNotices(ctx, schemeId);
    expect(notices).toHaveLength(3);
    expect(notices.every((n) => n.status === "issued" && n.payid)).toBe(true);

    // Quarter total within rounding of annual/4 — and shop lot pays double.
    const quarterTotal = notices.reduce((a, n) => a + n.totalCents, 0);
    expect(Math.abs(quarterTotal - 6_000_000 / 4)).toBeLessThanOrEqual(3);

    // Duplicate issue is blocked.
    await expect(leviesService.issueLevyRun(ctx, schemeId, scheduleId, 1)).rejects.toThrow(
      /already issued/i,
    );

    // Every owner got a notice email with the payment reference.
    expect(memoryEmail.sent).toHaveLength(3);
    expect(memoryEmail.sent[0]!.text).toContain("PayID");
  });

  it("reconciles a full payment end-to-end via the webhook parser", async () => {
    const ctx = ctxAt("2026-06-05T00:00:00Z");
    const notices = await leviesService.listNotices(ctx, schemeId);
    const notice = notices.find((n) => n.payid!.includes("ln-2026-01-1"))!; // shop lot

    memoryEmail.sent.length = 0;
    const provider = integrations.payments;
    const body = provider.buildWebhookBody({
      payid: notice.payid!,
      amountCents: notice.totalCents,
      paidAt: "2026-06-05T00:00:00Z",
      payerName: "Sam Shopkeeper",
    });
    const parsed = provider.parseWebhook(body);
    const result = await paymentsService.recordInboundPayment(ctx, "mock", parsed);

    expect(result.matched).toBe(true);
    expect(result.levyNoticeId).toBe(notice.id);

    const after = await leviesService.listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === notice.id)!.status).toBe("paid");

    // Lot ledger is square; funds got the split.
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice.lotId);
    expect(statement.balanceCents).toBe(0);
    const fundRows = await tdb.db.query.funds.findMany({
      where: eq(funds.schemeId, schemeId),
    });
    expect(fundRows.reduce((a, f) => a + f.balanceCents, 0)).toBe(notice.totalCents);

    // Receipt email went out.
    expect(memoryEmail.sent.some((e) => e.subject.startsWith("Receipt"))).toBe(true);

    // Webhook replay (same providerRef) is a no-op.
    const replay = await paymentsService.recordInboundPayment(ctx, "mock", parsed);
    expect(replay.duplicate).toBe(true);
  });

  it("parks ambiguous payments as unmatched and rejects unattributable ones", async () => {
    const ctx = ctxAt("2026-06-06T00:00:00Z");
    const provider = integrations.payments;
    // Two remaining notices have identical amounts (equal liability) —
    // a reference-less payment of that amount must not match either.
    const notices = (await leviesService.listNotices(ctx, schemeId)).filter(
      (n) => n.status === "issued",
    );
    expect(notices).toHaveLength(2);
    expect(notices[0]!.totalCents).toBe(notices[1]!.totalCents);

    // Unknown reference AND unknown destination account → no scheme to park
    // it in; the webhook route keeps the delivery on the ledger for retry.
    const body = provider.buildWebhookBody({
      payid: `unknown-${randomUUID()}`,
      amountCents: 123,
      paidAt: "2026-06-06T00:00:00Z",
      payerName: "Mystery",
    });
    await expect(
      paymentsService.recordInboundPayment(ctx, "mock", provider.parseWebhook(body)),
    ).rejects.toThrow(/cannot resolve scheme/);

    // Unknown reference but the money landed in the scheme's OWN collection
    // account, and the amount is ambiguous (two equal notices) → PARKED as
    // unmatched in that scheme, never guessed, never dropped.
    const account = await trustAccountsService.getSchemeTrustAccount(ctx, schemeId);
    const body2 = provider.buildWebhookBody({
      payid: `unknown-${randomUUID()}`,
      amountCents: notices[0]!.totalCents,
      accountNumber: account!.accountNumber,
      paidAt: "2026-06-06T00:00:00Z",
      payerName: "Mystery",
    });
    const result = await paymentsService.recordInboundPayment(
      ctx,
      "mock",
      provider.parseWebhook(body2),
    );
    expect(result.matched).toBe(false);
    expect(result.paymentId).toBeTruthy();
    const rows = await paymentsService.listPayments(ctx, schemeId);
    expect(rows.find((p) => p.id === result.paymentId)!.status).toBe("unmatched");
    // No ledger movement until a human matches it.
    for (const n of notices) {
      const statement = await arrearsService.lotStatement(ctx, schemeId, n.lotId);
      expect(statement.balanceCents).toBe(n.totalCents);
    }
  });

  it("walks the arrears ladder with one event per stage", async () => {
    // Due 2026-07-01; two lots unpaid. Day 40 → stage 3 directly.
    const ctx40 = ctxAt("2026-08-10T00:00:00Z");
    const scan1 = await arrearsService.scanArrears(ctx40, schemeId);
    expect(scan1.emitted).toHaveLength(2);
    expect(scan1.emitted.every((e) => e.stage === 3)).toBe(true);

    // Same day again — nothing new.
    const scan2 = await arrearsService.scanArrears(ctx40, schemeId);
    expect(scan2.emitted).toHaveLength(0);

    // Day 61 → stage 4 for both.
    const ctx61 = ctxAt("2026-08-31T00:00:00Z");
    const scan3 = await arrearsService.scanArrears(ctx61, schemeId);
    expect(scan3.emitted).toHaveLength(2);
    expect(scan3.emitted.every((e) => e.stage === 4)).toBe(true);

    // Notices flipped to overdue.
    const notices = await leviesService.listNotices(ctx61, schemeId);
    expect(notices.filter((n) => n.status === "overdue")).toHaveLength(2);

    // Arrears view includes accrued interest at the scheme rate (10% pa).
    const arrears = await arrearsService.arrearsForScheme(ctx61, schemeId);
    expect(arrears).toHaveLength(2);
    for (const lot of arrears) {
      expect(lot.daysOverdue).toBe(61);
      expect(lot.interestAccruedCents).toBeGreaterThan(0);
    }
  });

  it("approved debt recovery sends the formal demand via the executor", async () => {
    const ctx = ctxAt("2026-08-31T00:00:00Z", userActor(managerUserId));
    const arrears = await arrearsService.arrearsForScheme(ctx, schemeId);
    const target = arrears[0]!;

    const decision = await decisionsService.requestDecision(ctx, {
      schemeId,
      kind: "debt_recovery",
      title: "Commence debt recovery",
      summaryMd: "Lot is 61 days in arrears.",
      subject: { type: "lot", id: target.lotId },
      deciderRole: "committee",
      followUp: {
        type: "action",
        action: "finance.commenceDebtRecovery",
        args: { lotId: target.lotId },
      },
    });

    await decisionsService.resolveDecision(ctx, schemeId, decision.id, "approve", ["chair"]);

    memoryEmail.sent.length = 0;
    const execCtx = ctxAt("2026-08-31T00:00:00Z", systemActor("decision-executor"));
    const { executed } = await decisionsService.executeDecisionFollowUp(execCtx, decision.id);
    expect(executed).toBe("finance.commenceDebtRecovery");

    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.subject).toMatch(/FORMAL DEMAND/);
    expect(memoryEmail.sent[0]!.text).toContain("penalty interest");

    // Declined follow-ups never execute.
    const decision2 = await decisionsService.requestDecision(ctx, {
      schemeId,
      kind: "debt_recovery",
      title: "Recovery for the other lot",
      summaryMd: "…",
      deciderRole: "committee",
      followUp: {
        type: "action",
        action: "finance.commenceDebtRecovery",
        args: { lotId: arrears[1]!.lotId },
      },
    });
    await decisionsService.resolveDecision(ctx, schemeId, decision2.id, "decline", ["chair"]);
    const result2 = await decisionsService.executeDecisionFollowUp(execCtx, decision2.id);
    expect(result2.executed).toBeNull();
  });
});

describe("payments hardening (suspense, manual rail, overpayment)", () => {
  // Continues the money-loop state: two overdue instalment-1 notices remain
  // (lots 2 and 3, equal amounts) plus one payment parked earlier.
  let parkedPaymentId: string;

  it("rejects invalid amounts and foreign currency before touching the ledger", async () => {
    const ctx = ctxAt("2026-09-01T00:00:00Z");
    const base = {
      providerRef: `bad-${randomUUID()}`,
      payid: "whatever",
      paidAt: "2026-09-01T00:00:00Z",
      payerName: "Broken",
      raw: {},
    };
    await expect(
      paymentsService.recordInboundPayment(ctx, "mock", { ...base, amountCents: 0 }),
    ).rejects.toThrow(/invalid amount/);
    await expect(
      paymentsService.recordInboundPayment(ctx, "mock", { ...base, amountCents: -5000 }),
    ).rejects.toThrow(/invalid amount/);
    await expect(
      paymentsService.recordInboundPayment(ctx, "mock", { ...base, amountCents: Number.NaN }),
    ).rejects.toThrow(/invalid amount/);
    await expect(
      paymentsService.recordInboundPayment(ctx, "mock", {
        ...base,
        amountCents: 5000,
        currency: "USD",
      }),
    ).rejects.toThrow(/unsupported currency/);
  });

  it("parks an unknown-reference payment on the scheme's account for manual matching", async () => {
    const ctx = ctxAt("2026-09-01T00:00:00Z");
    const account = await trustAccountsService.getSchemeTrustAccount(ctx, schemeId);
    const result = await paymentsService.recordInboundPayment(ctx, "mock", {
      providerRef: `hardening-${randomUUID()}`,
      payid: `typo-${randomUUID()}`,
      amountCents: 123,
      accountNumber: account!.accountNumber,
      paidAt: "2026-09-01T00:00:00Z",
      payerName: "Mystery Payer",
      raw: {},
    });
    expect(result.matched).toBe(false);
    parkedPaymentId = result.paymentId;
    const rows = await paymentsService.listPayments(ctx, schemeId);
    expect(rows.find((p) => p.id === parkedPaymentId)!.status).toBe("unmatched");
  });

  it("treasurer manually matches the parked payment through the full receipt chain", async () => {
    const ctx = ctxAt("2026-09-01T12:00:00Z", userActor(managerUserId));
    const overdue = (await leviesService.listNotices(ctx, schemeId)).filter(
      (n) => n.status === "overdue",
    );
    const target = overdue[0]!;
    const before = await arrearsService.lotStatement(ctx, schemeId, target.lotId);

    memoryEmail.sent.length = 0;
    const result = await paymentsService.matchPaymentToNotice(
      ctx,
      schemeId,
      parkedPaymentId,
      target.id,
    );
    expect(result.matched).toBe(true);
    expect(result.levyNoticeId).toBe(target.id);
    expect(result.receiptNumber).toMatch(/^R-/);

    // Ledger credited exactly the parked amount; notice now partially paid.
    const after = await arrearsService.lotStatement(ctx, schemeId, target.lotId);
    expect(after.balanceCents).toBe(before.balanceCents - 123);
    const notices = await leviesService.listNotices(ctx, schemeId);
    expect(notices.find((n) => n.id === target.id)!.status).toBe("partially_paid");

    // Receipt email went out; a second manual match is refused.
    expect(memoryEmail.sent.some((e) => e.subject.startsWith("Receipt"))).toBe(true);
    await expect(
      paymentsService.matchPaymentToNotice(ctx, schemeId, parkedPaymentId, target.id),
    ).rejects.toThrow(/only unmatched/);
  });

  it("records a manual bank transfer through the identical chain, idempotent on reference", async () => {
    const ctx = ctxAt("2026-09-02T00:00:00Z", userActor(managerUserId));
    const overdue = (await leviesService.listNotices(ctx, schemeId)).filter(
      (n) => n.status === "overdue",
    );
    expect(overdue).toHaveLength(1); // the other one is now partially paid
    const notice = overdue[0]!;

    memoryEmail.sent.length = 0;
    const input = {
      levyNoticeId: notice.id,
      amountCents: notice.totalCents,
      paidAt: "2026-09-02",
      payerName: "Kim Nguyen",
      reference: "BANK-STMT-042",
    };
    const result = await paymentsService.recordManualPayment(ctx, schemeId, input);
    expect(result.matched).toBe(true);
    expect(result.receiptNumber).toMatch(/^R-/);

    const after = await leviesService.listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === notice.id)!.status).toBe("paid");
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice.lotId);
    expect(statement.balanceCents).toBe(0);
    expect(memoryEmail.sent.some((e) => e.subject.startsWith("Receipt"))).toBe(true);

    // The same bank-statement line recorded twice must not double-credit.
    const dup = await paymentsService.recordManualPayment(ctx, schemeId, input);
    expect(dup.duplicate).toBe(true);
    const statement2 = await arrearsService.lotStatement(ctx, schemeId, notice.lotId);
    expect(statement2.balanceCents).toBe(0);
  });

  it("refuses a manual payment against a settled notice", async () => {
    const ctx = ctxAt("2026-09-02T12:00:00Z", userActor(managerUserId));
    const paid = (await leviesService.listNotices(ctx, schemeId)).find((n) => n.status === "paid")!;
    await expect(
      paymentsService.recordManualPayment(ctx, schemeId, {
        levyNoticeId: paid.id,
        amountCents: 1000,
        paidAt: "2026-09-02",
      }),
    ).rejects.toThrow(/no longer accepts payments/);
  });

  it("credits an overpayment to the lot ledger", async () => {
    const ctx = ctxAt("2026-09-03T00:00:00Z", userActor(managerUserId));
    const schedules = await leviesService.listSchedules(ctx, schemeId);
    await leviesService.issueLevyRun(ctx, schemeId, schedules[0]!.id, 2);

    const shop = (await leviesService.listNotices(ctx, schemeId)).find(
      (n) => n.instalment === 2 && n.payid!.includes("ln-2026-02-1"),
    )!;
    const provider = integrations.payments;
    const body = provider.buildWebhookBody({
      payid: shop.payid!,
      amountCents: shop.totalCents + 5_000, // $50 over
      paidAt: "2026-09-03T00:00:00Z",
      payerName: "Sam Shopkeeper",
    });
    const result = await paymentsService.recordInboundPayment(
      ctx,
      "mock",
      provider.parseWebhook(body),
    );
    expect(result.matched).toBe(true);

    const after = await leviesService.listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === shop.id)!.status).toBe("paid");
    // The lot sits $50 in CREDIT — absorbed by the next levy charge.
    const statement = await arrearsService.lotStatement(ctx, schemeId, shop.lotId);
    expect(statement.balanceCents).toBe(-5_000);
  });

  it("parks a second payment quoting a SETTLED notice instead of amount-guessing another lot", async () => {
    const ctx = ctxAt("2026-09-04T00:00:00Z");
    const notices = await leviesService.listNotices(ctx, schemeId);
    const settled = notices.find((n) => n.instalment === 2 && n.status === "paid")!;
    const partiallyPaid = notices.find((n) => n.status === "partially_paid")!;
    // Amount equal to the partially-paid notice's UNIQUE outstanding — the
    // amount heuristic would bite if the settled-reference guard didn't.
    const trapAmount = partiallyPaid.totalCents - 123;

    const provider = integrations.payments;
    const body = provider.buildWebhookBody({
      payid: settled.payid!, // duplicate payment quoting the paid notice
      amountCents: trapAmount,
      paidAt: "2026-09-04T00:00:00Z",
      payerName: "Sam Shopkeeper",
    });
    const result = await paymentsService.recordInboundPayment(
      ctx,
      "mock",
      provider.parseWebhook(body),
    );
    expect(result.matched).toBe(false); // parked, never misallocated

    const after = await leviesService.listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === partiallyPaid.id)!.status).toBe("partially_paid");
    const rows = await paymentsService.listPayments(ctx, schemeId);
    expect(rows.find((p) => p.id === result.paymentId)!.status).toBe("unmatched");
  });

  it("reports the payments status surface (provider, account, suspense queue)", async () => {
    const ctx = ctxAt("2026-09-05T00:00:00Z");
    const status = await paymentsService.paymentsStatus(ctx, schemeId);
    expect(status.provider).toBe("mock");
    expect(status.trustAccount?.status).toBe("active");
    expect(status.trustAccount?.bsb).toBeTruthy();
    expect(status.trustAccount?.accountNumber).toBeTruthy();
    // The mid-suite ambiguous payment + the settled-reference duplicate.
    expect(status.unmatchedCount).toBe(2);
    expect(status.lastPaymentAt).toBeTruthy();
  });
});
