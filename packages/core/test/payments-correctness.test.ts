import { randomUUID } from "node:crypto";
import {
  budgetLines,
  budgets,
  documents,
  eventLog,
  funds,
  lotLedgerEntries,
  lots,
  ownerships,
  people,
  receipts,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, type Clock, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { interestAccrued } from "../src/engines/interest.js";
import * as arrearsService from "../src/services/arrears.js";
import * as leviesService from "../src/services/levies.js";
import * as paymentsService from "../src/services/payments.js";

/**
 * Payments-correctness coverage for the audit fixes:
 *  - penalty interest is POSTED to the lot ledger by the daily sweep,
 *    engine-exact and idempotent (re-runs and same-day overlaps never
 *    double-post), and every quoted arrears figure is ledger-derived;
 *  - issued levy notices and receipts persist as stored PDF documents at
 *    accessLevel "admin" (a per-lot financial record must not be owner-wide);
 *  - levy.period.opened / levy.notice.overdue are published at their natural
 *    points;
 *  - write-off: status transition + balancing adjustment + typed event,
 *    idempotent;
 *  - refund: full reversal of allocations/ledger/funds + typed event,
 *    idempotent.
 */

let tdb: TestDatabase;
let schemeId: string;
const lotIds: string[] = [];
const treasurerId = "user-correct-treasurer";

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const T0 = "2026-06-01T00:00:00Z"; // issue date; instalment 1 due 2026-07-01
function ctxAt(iso: string, actor: Actor = userActor(treasurerId)): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

let scheduleId: string;

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Correctness OC",
      planOfSubdivision: "PS999999C",
      addressLine1: "9 Audit Ln",
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
    id: treasurerId,
    name: "Tessa Treasurer",
    email: "tessa@example.com",
  });

  for (const [lotNumber, ownerEmail] of [
    ["1", "ada@example.com"],
    ["2", "ben@example.com"],
  ] as const) {
    const lotRows = await tdb.db
      .insert(lots)
      .values({ schemeId, lotNumber, entitlement: 10, liability: 10 })
      .returning();
    lotIds.push(lotRows[0]!.id);
    const personRows = await tdb.db
      .insert(people)
      .values({ schemeId, givenName: `Owner${lotNumber}`, familyName: "Test", email: ownerEmail })
      .returning();
    await tdb.db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personRows[0]!.id,
      startedOn: "2020-01-01",
    });
  }

  // Factory: an already-adopted budget (the adoption flow is covered by the
  // levy-loop suite). Annual admin 240000 → 30000 per lot per quarter.
  const budget = (
    await tdb.db
      .insert(budgets)
      .values({ schemeId, fiscalYearStart: "2026-07-01", status: "adopted" })
      .returning()
  )[0]!;
  await tdb.db.insert(budgetLines).values({
    budgetId: budget.id,
    fundKind: "admin",
    category: "general",
    description: "Administration fund",
    amountCents: 240_000,
  });

  const schedule = await leviesService.createLevySchedule(ctxAt(T0), schemeId, {
    budgetId: budget.id,
    frequency: "quarterly",
    firstDueOn: "2026-07-01",
  });
  scheduleId = schedule.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("issued levy notices persist as stored PDFs + levy.period.opened", () => {
  it("issues instalment 1 with a stored admin-tier PDF per notice and one period event", async () => {
    const ctx = ctxAt(T0);
    const result = await leviesService.issueLevyRun(ctx, schemeId, scheduleId, 1);
    expect(result.issued).toBe(2);

    // levy.period.opened published exactly once, typed payload.
    const periodEvents = await tdb.db.query.eventLog.findMany({
      where: and(eq(eventLog.schemeId, schemeId), eq(eventLog.type, "levy.period.opened")),
    });
    expect(periodEvents).toHaveLength(1);
    expect(periodEvents[0]!.payload).toMatchObject({
      levyScheduleId: scheduleId,
      instalment: 1,
      dueOn: "2026-07-01",
      noticeCount: 2,
    });

    // Every notice persisted its issued PDF as a documents row.
    const notices = await leviesService.listNotices(ctx, schemeId);
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice.documentId).toBeTruthy();
      const doc = await tdb.db.query.documents.findFirst({
        where: eq(documents.id, notice.documentId!),
      });
      expect(doc).toBeTruthy();
      expect(doc!.schemeId).toBe(schemeId);
      expect(doc!.category).toBe("levy_notice");
      // PRIVACY: a per-lot levy notice must NOT be owner-wide readable —
      // "owners" means every owner in the scheme. The audit copy is admin-tier.
      expect(doc!.accessLevel).toBe("admin");
      expect(doc!.mime).toBe("application/pdf");
      expect(doc!.sizeBytes).toBeGreaterThan(0);
      // The object really exists in storage and is a PDF.
      const bytes = await integrations.storage.get(doc!.storageKey);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    }
  });
});

describe("penalty interest: posted to the ledger, engine-exact, idempotent", () => {
  const day30 = interestAccrued(30_000, 1_000, 30, 0); // 247
  const day31 = interestAccrued(30_000, 1_000, 31, 0); // 255

  it("the sweep posts interest once per lot per day; re-runs are no-ops", async () => {
    // 30 days overdue.
    const ctx = ctxAt("2026-07-31T00:00:00Z", systemActor("cron"));
    const scan = await arrearsService.scanArrears(ctx, schemeId);
    expect(scan.scanned).toBe(2);
    expect(scan.interestPosted).toHaveLength(2);
    expect(scan.interestPosted.every((p) => p.amountCents === day30)).toBe(true);

    // levy.notice.overdue published once per flipped notice.
    const overdueEvents = await tdb.db.query.eventLog.findMany({
      where: and(eq(eventLog.schemeId, schemeId), eq(eventLog.type, "levy.notice.overdue")),
    });
    expect(overdueEvents).toHaveLength(2);

    // Ledger entries of kind "interest" landed, engine-exact.
    for (const lotId of lotIds) {
      const statement = await arrearsService.lotStatement(ctx, schemeId, lotId);
      const interestEntries = statement.entries.filter((e) => e.kind === "interest");
      expect(interestEntries).toHaveLength(1);
      expect(interestEntries[0]!.amountCents).toBe(day30);
      expect(statement.balanceCents).toBe(30_000 + day30);
    }

    // Same-day re-run: nothing double-posts, no duplicate overdue events.
    const again = await arrearsService.scanArrears(ctx, schemeId);
    expect(again.interestPosted).toHaveLength(0);
    const overdueEvents2 = await tdb.db.query.eventLog.findMany({
      where: and(eq(eventLog.schemeId, schemeId), eq(eventLog.type, "levy.notice.overdue")),
    });
    expect(overdueEvents2).toHaveLength(2);
    const statement = await arrearsService.lotStatement(ctx, schemeId, lotIds[0]!);
    expect(statement.balanceCents).toBe(30_000 + day30);
  });

  it("the next day posts only the delta, and the read model is ledger-derived", async () => {
    const ctx = ctxAt("2026-08-01T00:00:00Z", systemActor("cron"));
    const scan = await arrearsService.scanArrears(ctx, schemeId);
    expect(scan.interestPosted).toHaveLength(2);
    expect(scan.interestPosted.every((p) => p.amountCents === day31 - day30)).toBe(true);

    const arrears = await arrearsService.arrearsForScheme(ctx, schemeId);
    expect(arrears).toHaveLength(2);
    for (const row of arrears) {
      expect(row.outstandingCents).toBe(30_000);
      expect(row.interestAccruedCents).toBe(day31);
      // The quoted total reconciles exactly with the lot statement.
      const statement = await arrearsService.lotStatement(ctx, schemeId, row.lotId);
      expect(row.outstandingCents + row.interestAccruedCents).toBe(statement.balanceCents);
    }
  });

  it("paying the quoted total (levies + posted interest) squares the lot, and the receipt PDF persists", async () => {
    const ctx = ctxAt("2026-08-02T00:00:00Z");
    const notice = (await leviesService.listNotices(ctx, schemeId)).find(
      (n) => n.lotId === lotIds[0],
    )!;
    const quoted = await arrearsService.lotStatement(ctx, schemeId, lotIds[0]!);
    expect(quoted.balanceCents).toBe(30_000 + day31);

    const result = await paymentsService.recordManualPayment(ctx, schemeId, {
      levyNoticeId: notice.id,
      amountCents: quoted.balanceCents,
      paidAt: "2026-08-02",
      payerName: "Owner1 Test",
      reference: "QUOTED-TOTAL-1",
    });
    expect(result.matched).toBe(true);

    // The lot is square — no phantom residue, no overpayment.
    const after = await arrearsService.lotStatement(ctx, schemeId, lotIds[0]!);
    expect(after.balanceCents).toBe(0);
    const notices = await leviesService.listNotices(ctx, schemeId);
    expect(notices.find((n) => n.id === notice.id)!.status).toBe("paid");

    // Receipt persisted as an admin-tier stored PDF.
    const receipt = await tdb.db.query.receipts.findFirst({
      where: and(eq(receipts.schemeId, schemeId), eq(receipts.paymentId, result.paymentId)),
    });
    expect(receipt).toBeTruthy();
    expect(receipt!.documentId).toBeTruthy();
    const doc = await tdb.db.query.documents.findFirst({
      where: eq(documents.id, receipt!.documentId!),
    });
    expect(doc!.accessLevel).toBe("admin");
    expect(doc!.category).toBe("financial");
    expect(doc!.mime).toBe("application/pdf");
  });
});

describe("write-off of an uncollectible notice", () => {
  const day31 = interestAccrued(30_000, 1_000, 31, 0);
  let noticeBId: string;

  it("transitions status, posts the balancing adjustment, clears stranded interest, publishes the event", async () => {
    const ctx = ctxAt("2026-08-03T00:00:00Z");
    noticeBId = (await leviesService.listNotices(ctx, schemeId)).find(
      (n) => n.lotId === lotIds[1],
    )!.id;

    const result = await leviesService.writeOffLevyNotice(
      ctx,
      schemeId,
      noticeBId,
      "Owner deceased; estate insolvent",
    );
    expect(result.alreadyWrittenOff).toBe(false);
    expect(result.writtenOffCents).toBe(30_000);
    // The lot's only open notice: its posted interest is equally
    // uncollectible and is cleared with it.
    expect(result.interestWrittenOffCents).toBe(day31);

    const notices = await leviesService.listNotices(ctx, schemeId);
    expect(notices.find((n) => n.id === noticeBId)!.status).toBe("written_off");

    const statement = await arrearsService.lotStatement(ctx, schemeId, lotIds[1]!);
    expect(statement.balanceCents).toBe(0);
    const adjustments = statement.entries.filter((e) => e.kind === "adjustment");
    expect(adjustments.map((a) => a.amountCents).sort((a, b) => a - b)).toEqual([-30_000, -day31]);

    const events = await tdb.db.query.eventLog.findMany({
      where: and(eq(eventLog.schemeId, schemeId), eq(eventLog.type, "levy.notice.written_off")),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      levyNoticeId: noticeBId,
      writtenOffCents: 30_000,
      interestWrittenOffCents: day31,
      reason: "Owner deceased; estate insolvent",
    });

    // The lot has left the arrears view entirely.
    const arrears = await arrearsService.arrearsForScheme(ctx, schemeId);
    expect(arrears).toHaveLength(0);
  });

  it("is idempotent, refuses non-open notices, and a written-off notice accepts no payments", async () => {
    const ctx = ctxAt("2026-08-03T12:00:00Z");
    const entriesBefore = await tdb.db.query.lotLedgerEntries.findMany({
      where: and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotIds[1]!)),
    });

    // Repeat write-off: a no-op, no second adjustment.
    const repeat = await leviesService.writeOffLevyNotice(ctx, schemeId, noticeBId, "again");
    expect(repeat.alreadyWrittenOff).toBe(true);
    expect(repeat.writtenOffCents).toBe(0);
    const entriesAfter = await tdb.db.query.lotLedgerEntries.findMany({
      where: and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotIds[1]!)),
    });
    expect(entriesAfter).toHaveLength(entriesBefore.length);

    // A PAID notice refuses write-off.
    const paid = (await leviesService.listNotices(ctx, schemeId)).find((n) => n.status === "paid")!;
    await expect(
      leviesService.writeOffLevyNotice(ctx, schemeId, paid.id, "nope"),
    ).rejects.toMatchObject({ code: "NOTICE_NOT_OPEN", status: 422 });

    // An unknown notice 404s.
    await expect(
      leviesService.writeOffLevyNotice(ctx, schemeId, randomUUID(), "nope"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // The written-off notice no longer accepts money.
    await expect(
      paymentsService.recordManualPayment(ctx, schemeId, {
        levyNoticeId: noticeBId,
        amountCents: 1_000,
        paidAt: "2026-08-03",
      }),
    ).rejects.toMatchObject({ code: "NOTICE_NOT_OPEN", status: 422 });
  });
});

describe("refund/reversal of a recorded payment", () => {
  let noticeId: string;
  let paymentId: string;
  let fundsBefore: number;

  it("reverses allocations, ledger credit, fund split and notice status", async () => {
    // Instalment 2 (due 2026-10-01) gives a fresh, open notice.
    const ctx = ctxAt("2026-09-10T00:00:00Z");
    await leviesService.issueLevyRun(ctx, schemeId, scheduleId, 2);
    const notice = (await leviesService.listNotices(ctx, schemeId)).find(
      (n) => n.instalment === 2 && n.lotId === lotIds[0],
    )!;
    noticeId = notice.id;

    const fundRows = await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) });
    fundsBefore = fundRows.reduce((a, f) => a + f.balanceCents, 0);

    const payCtx = ctxAt("2026-09-15T00:00:00Z");
    const paid = await paymentsService.recordManualPayment(payCtx, schemeId, {
      levyNoticeId: notice.id,
      amountCents: notice.totalCents,
      paidAt: "2026-09-15",
      payerName: "Owner1 Test",
      reference: "REFUND-TEST-1",
    });
    expect(paid.matched).toBe(true);
    paymentId = paid.paymentId;

    const fundsAfterPay = (
      await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) })
    ).reduce((a, f) => a + f.balanceCents, 0);
    expect(fundsAfterPay).toBe(fundsBefore + notice.totalCents);

    // The refund.
    const refundCtx = ctxAt("2026-09-16T00:00:00Z");
    const refund = await paymentsService.refundPayment(
      refundCtx,
      schemeId,
      paymentId,
      "Paid from the wrong account; owner requested reversal",
    );
    expect(refund.status).toBe("refunded");
    expect(refund.alreadyRefunded).toBe(false);
    expect(refund.levyNoticeIds).toEqual([notice.id]);

    // Payment status flipped.
    const rows = await paymentsService.listPayments(refundCtx, schemeId);
    expect(rows.find((p) => p.id === paymentId)!.status).toBe("refunded");

    // Notice reopened (due date still in the future → issued, not overdue).
    const after = await leviesService.listNotices(refundCtx, schemeId);
    expect(after.find((n) => n.id === notice.id)!.status).toBe("issued");

    // Lot ledger: credit + reversing adjustment leave the charge owing again.
    const statement = await arrearsService.lotStatement(refundCtx, schemeId, lotIds[0]!);
    expect(statement.balanceCents).toBe(notice.totalCents);

    // Funds restored, with explicit reversal transactions on the books.
    const fundsAfterRefund = (
      await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) })
    ).reduce((a, f) => a + f.balanceCents, 0);
    expect(fundsAfterRefund).toBe(fundsBefore);

    // Typed event on the log.
    const events = await tdb.db.query.eventLog.findMany({
      where: and(eq(eventLog.schemeId, schemeId), eq(eventLog.type, "payment.refunded")),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ paymentId, levyNoticeIds: [notice.id] });
  });

  it("is idempotent: a second refund is a no-op", async () => {
    const ctx = ctxAt("2026-09-16T01:00:00Z");
    const again = await paymentsService.refundPayment(ctx, schemeId, paymentId, "again");
    expect(again.alreadyRefunded).toBe(true);

    const statement = await arrearsService.lotStatement(ctx, schemeId, lotIds[0]!);
    expect(statement.balanceCents).toBe(30_000); // unchanged — no double reversal
    const fundsNow = (
      await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) })
    ).reduce((a, f) => a + f.balanceCents, 0);
    expect(fundsNow).toBe(fundsBefore);
  });

  it("the reopened notice accepts a replacement payment through the normal chain", async () => {
    const ctx = ctxAt("2026-09-17T00:00:00Z");
    const result = await paymentsService.recordManualPayment(ctx, schemeId, {
      levyNoticeId: noticeId,
      amountCents: 30_000,
      paidAt: "2026-09-17",
      reference: "REFUND-TEST-2",
    });
    expect(result.matched).toBe(true);
    const after = await leviesService.listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === noticeId)!.status).toBe("paid");
    const statement = await arrearsService.lotStatement(ctx, schemeId, lotIds[0]!);
    expect(statement.balanceCents).toBe(0);
  });

  it("refunding a parked (unmatched) payment just flips it — no ledger or fund movement", async () => {
    const ctx = ctxAt("2026-09-18T00:00:00Z");
    const parked = await paymentsService.recordManualPayment(ctx, schemeId, {
      amountCents: 555, // matches nothing → parked
      paidAt: "2026-09-18",
      payerName: "Mystery",
    });
    expect(parked.matched).toBe(false);

    const fundsBeforeRefund = (
      await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) })
    ).reduce((a, f) => a + f.balanceCents, 0);

    const refund = await paymentsService.refundPayment(ctx, schemeId, parked.paymentId, "returned");
    expect(refund.status).toBe("refunded");
    expect(refund.levyNoticeIds).toEqual([]);

    const fundsAfterRefund = (
      await tdb.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) })
    ).reduce((a, f) => a + f.balanceCents, 0);
    expect(fundsAfterRefund).toBe(fundsBeforeRefund);

    // A refunded payment can't be matched or refunded again.
    await expect(
      paymentsService.matchPaymentToNotice(ctx, schemeId, parked.paymentId, noticeId),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_UNMATCHED", status: 409 });
    const again = await paymentsService.refundPayment(ctx, schemeId, parked.paymentId, "again");
    expect(again.alreadyRefunded).toBe(true);
  });

  it("an unknown payment 404s", async () => {
    const ctx = ctxAt("2026-09-18T01:00:00Z");
    await expect(
      paymentsService.refundPayment(ctx, schemeId, randomUUID(), "nope"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
