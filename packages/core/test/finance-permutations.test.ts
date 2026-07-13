import { randomUUID } from "node:crypto";
import {
  budgetLines,
  budgets,
  funds,
  lots,
  meetings,
  motions,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, type Clock, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { interestAccrued } from "../src/engines/interest.js";
import * as arrearsService from "../src/services/arrears.js";
import {
  adoptBudget,
  createBudget,
  createBudgetInput,
  listBudgets,
} from "../src/services/budgets.js";
import * as decisionsService from "../src/services/decisions.js";
import {
  authoriseInterest,
  authoriseInterestInput,
} from "../src/services/interestAuthorisations.js";
import {
  createLevySchedule,
  createLevyScheduleInput,
  createSpecialFeeInput,
  issueLevyRun,
  listNotices,
} from "../src/services/levies.js";
import {
  listPayments,
  matchPaymentToNotice,
  recordManualPayment,
  recordManualPaymentInput,
} from "../src/services/payments.js";

/**
 * Permutation coverage for the finance family (budgets → schedules → notices →
 * payments → arrears), complementing levy-loop.test.ts's happy money loop:
 *  - money boundary values as the WEB CLIENT computes them (cents = Math.round(Number(v)*100))
 *    against the server-side zod input schemas — the real client/server contract;
 *  - sequencing/business-rule permutations with exact DomainError codes + HTTP statuses;
 *  - the manual-payment rail's partial/overpay/park/match permutations;
 *  - the arrears read model agreeing exactly with the deterministic interest engine.
 */

// ---------------------------------------------------------------------------
// Layer 1: input schemas × the client's dollars→cents formula (pure, no DB)
// ---------------------------------------------------------------------------

/** EXACTLY the conversion FinanceTab.tsx performs before POSTing. */
const toCents = (v: string) => Math.round(Number(v) * 100);

describe("money boundaries: client cents formula vs server schemas", () => {
  it("converts dollar strings to cents deterministically (locks the client formula)", () => {
    expect(toCents("250.00")).toBe(25_000);
    expect(toCents("0")).toBe(0);
    expect(toCents("-5")).toBe(-500);
    expect(toCents("0.004")).toBe(0); // rounds DOWN to zero cents
    expect(toCents("0.005")).toBe(1); // rounds up to one cent
    expect(toCents("33.335")).toBe(3_334); // half-cent rounds up (fp: 3333.5000…5)
    expect(toCents("1e3")).toBe(100_000); // scientific notation is a valid Number
    expect(toCents("")).toBe(0); // Number("") === 0 — client zod must catch first
    expect(toCents("1,000")).toBeNaN(); // thousands separator → NaN
    expect(toCents("999999999.99")).toBe(99_999_999_999);
    expect(Number.isSafeInteger(toCents("999999999.99"))).toBe(true);
  });

  const budget = (adminCents: number, maintenanceCents = 0) =>
    createBudgetInput.safeParse({ fiscalYearStart: "2026-07-01", adminCents, maintenanceCents });

  it("createBudgetInput: admin must be a positive integer number of cents", () => {
    expect(budget(toCents("250.00")).success).toBe(true);
    expect(budget(toCents("0")).success).toBe(false); // '0' → 0 → rejected
    expect(budget(toCents("-5")).success).toBe(false); // negative
    expect(budget(toCents("0.004")).success).toBe(false); // rounds to 0 → server catches it
    expect(budget(toCents("0.005")).success).toBe(true); // 1 cent is legal
    expect(budget(toCents("1e3")).success).toBe(true);
    expect(budget(toCents("")).success).toBe(false); // '' → 0 cents → rejected
    expect(budget(toCents("1,000")).success).toBe(false); // NaN fails int()
    expect(budget(toCents("999999999.99")).success).toBe(true);
    expect(budget(3333.5).success).toBe(false); // non-integer cents never accepted
  });

  it("createBudgetInput: maintenance allows exactly zero but never negative", () => {
    // The client sends Math.round(Number(values.maintenance || "0") * 100) — '' → 0.
    expect(budget(25_000, toCents("0")).success).toBe(true);
    expect(budget(25_000, toCents("-1")).success).toBe(false);
    expect(budget(25_000, 0.5).success).toBe(false);
  });

  it("createBudgetInput: fiscalYearStart must be a strict YYYY-MM-DD", () => {
    for (const bad of ["", "garbage", "2026-7-1", "01/07/2026", "2026-07-01T00:00:00Z"]) {
      expect(
        createBudgetInput.safeParse({ fiscalYearStart: bad, adminCents: 100, maintenanceCents: 0 })
          .success,
      ).toBe(false);
    }
  });

  const manual = (over: Record<string, unknown>) =>
    recordManualPaymentInput.safeParse({ amountCents: 25_000, paidAt: "2026-09-02", ...over });

  it("recordManualPaymentInput: amount boundary permutations", () => {
    expect(manual({}).success).toBe(true);
    expect(manual({ amountCents: toCents("0") }).success).toBe(false);
    expect(manual({ amountCents: toCents("-5") }).success).toBe(false);
    expect(manual({ amountCents: toCents("0.004") }).success).toBe(false); // 0 cents
    expect(manual({ amountCents: toCents("0.005") }).success).toBe(true); // 1 cent
    expect(manual({ amountCents: toCents("1,000") }).success).toBe(false); // NaN
    expect(manual({ amountCents: toCents("999999999.99") }).success).toBe(true);
    expect(manual({ amountCents: 100.5 }).success).toBe(false); // fractional cents
  });

  it("recordManualPaymentInput: dates, payer and reference permutations", () => {
    expect(manual({ paidAt: "" }).success).toBe(false);
    expect(manual({ paidAt: "yesterday" }).success).toBe(false);
    expect(manual({ paidAt: "02/09/2026" }).success).toBe(false);
    expect(manual({ payerName: "Kim Nguyen" }).success).toBe(true);
    expect(manual({ payerName: "x".repeat(201) }).success).toBe(false);
    expect(manual({ reference: "" }).success).toBe(false); // '' is not a dedupe key
    expect(manual({ reference: "BANK-42" }).success).toBe(true);
    // optional fields omitted entirely — the client omits empties
    expect(manual({ payerName: undefined, reference: undefined }).success).toBe(true);
  });

  it("createLevyScheduleInput: frequency enum + first due date", () => {
    const base = { budgetId: "b-1", firstDueOn: "2026-07-01" };
    expect(createLevyScheduleInput.safeParse({ ...base, frequency: "quarterly" }).success).toBe(
      true,
    );
    expect(createLevyScheduleInput.safeParse({ ...base, frequency: "weekly" }).success).toBe(false);
    // frequency omitted → defaults to quarterly (what the web dialog sends explicitly)
    const parsed = createLevyScheduleInput.parse(base);
    expect(parsed.frequency).toBe("quarterly");
    expect(createLevyScheduleInput.safeParse({ ...base, firstDueOn: "soon" }).success).toBe(false);
  });

  it("statutory interest is resolution-linked and cannot exceed the Victorian cap", () => {
    const base = {
      motionId: randomUUID(),
      effectiveFrom: "2026-07-01",
    };
    expect(authoriseInterestInput.safeParse({ ...base, rateBps: 1_000 }).success).toBe(true);
    expect(authoriseInterestInput.safeParse({ ...base, rateBps: 1_001 }).success).toBe(false);
    expect(authoriseInterestInput.safeParse({ ...base, rateBps: -1 }).success).toBe(false);
  });

  it("special fees require a carried-motion reference and explicit allocation method", () => {
    const base = {
      description: "Unexpected lift replacement",
      totalCents: 500_000,
      dueOn: "2026-09-01",
      motionId: randomUUID(),
      allocationMethod: "liability" as const,
    };
    expect(createSpecialFeeInput.safeParse(base).success).toBe(true);
    expect(createSpecialFeeInput.safeParse({ ...base, motionId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(createSpecialFeeInput.safeParse({ ...base, totalCents: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: sequencing / business-rule permutations against a real database
// ---------------------------------------------------------------------------

let tdb: TestDatabase;
let schemeId: string;
const lotIds: string[] = [];
const treasurerId = "user-perm-treasurer";
let adoptionMotionId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const T0 = "2026-06-01T00:00:00Z";
function ctxAt(iso: string, actor: Actor = userActor(treasurerId)): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Permutation OC",
      planOfSubdivision: "PS888888P",
      addressLine1: "2 Boundary St",
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
    name: "Petra Permutation",
    email: "petra@example.com",
  });

  // Two equal-liability lots → deterministic 50/50 apportionment.
  for (const [lotNumber, ownerEmail] of [
    ["1", "amy@example.com"],
    ["2", "bob@example.com"],
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
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("budget → schedule sequencing permutations", () => {
  let budgetId: string;

  it("refuses a schedule against a budget that does not exist", async () => {
    const ctx = ctxAt(T0);
    await expect(
      createLevySchedule(ctx, schemeId, {
        budgetId: randomUUID(),
        frequency: "quarterly",
        firstDueOn: "2026-07-01",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("refuses a schedule while the budget is still in committee review (422 BUDGET_NOT_ADOPTED)", async () => {
    const ctx = ctxAt(T0);
    const budget = await createBudget(ctx, schemeId, {
      fiscalYearStart: "2026-07-01",
      adminCents: 240_000,
      maintenanceCents: 0, // '' in the dialog → 0 cents — legal for maintenance
    });
    budgetId = budget.id;
    expect(budget.status).toBe("committee_review");

    await expect(
      createLevySchedule(ctx, schemeId, {
        budgetId,
        frequency: "quarterly",
        firstDueOn: "2026-07-01",
      }),
    ).rejects.toMatchObject({ code: "BUDGET_NOT_ADOPTED", status: 422 });
  });

  it("treasurer approval tables the proposal; a carried AGM motion adopts it", async () => {
    const ctx = ctxAt(T0);
    const pending = await decisionsService.listDecisions(ctx, schemeId, "pending");
    const decision = pending.find((d) => (d.subject as { id?: string } | null)?.id === budgetId)!;
    await decisionsService.resolveDecision(ctx, schemeId, decision.id, "approve", ["treasurer"]);
    await decisionsService.executeDecisionFollowUp(ctxAt(T0, systemActor("executor")), decision.id);

    const [meeting] = await tdb.db
      .insert(meetings)
      .values({
        schemeId,
        kind: "agm",
        title: "Annual general meeting",
        scheduledAt: new Date(T0),
        status: "closed",
      })
      .returning();
    const [motion] = await tdb.db
      .insert(motions)
      .values({
        schemeId,
        meetingId: meeting!.id,
        title: "Adopt annual budget",
        text: "That the proposed annual budget be adopted.",
        resolutionType: "ordinary",
        status: "carried",
      })
      .returning();
    adoptionMotionId = motion!.id;
    await adoptBudget(ctx, schemeId, budgetId, motion!.id);

    const all = await listBudgets(ctx, schemeId);
    const adopted = all.find((b) => b.id === budgetId)!;
    expect(adopted.status).toBe("adopted");
    // Both lines persist (admin 240000, maintenance 0)…
    expect(adopted.lines.map((l) => [l.fundKind, l.amountCents]).sort()).toEqual([
      ["admin", 240_000],
      ["maintenance", 0],
    ]);
  });

  it("frequency permutations fix the instalment count (quarterly 4, half_yearly 2, annual 1)", async () => {
    const ctx = ctxAt(T0);
    const q = await createLevySchedule(ctx, schemeId, {
      budgetId,
      frequency: "quarterly",
      firstDueOn: "2026-07-01",
    });
    const h = await createLevySchedule(ctx, schemeId, {
      budgetId,
      frequency: "half_yearly",
      firstDueOn: "2026-07-01",
    });
    const a = await createLevySchedule(ctx, schemeId, {
      budgetId,
      frequency: "annual",
      firstDueOn: "2026-07-01",
    });
    expect(q.instalments).toBe(4);
    expect(h.instalments).toBe(2);
    expect(a.instalments).toBe(1);

    // Out-of-range instalments per frequency — exact code and bound in message.
    await expect(issueLevyRun(ctx, schemeId, q.id, 0)).rejects.toMatchObject({
      code: "INVALID_INSTALMENT",
      status: 422,
    });
    await expect(issueLevyRun(ctx, schemeId, q.id, 5)).rejects.toMatchObject({
      code: "INVALID_INSTALMENT",
    });
    await expect(issueLevyRun(ctx, schemeId, h.id, 3)).rejects.toThrow(/1–2/);
    await expect(issueLevyRun(ctx, schemeId, a.id, 2)).rejects.toThrow(/1–1/);

    // Keep only the quarterly schedule live for the rest of the suite.
    quarterlyScheduleId = q.id;
  });

  it("issues instalment 1 with exact 50/50 cents apportionment, then blocks a re-issue (409)", async () => {
    const ctx = ctxAt(T0);
    const result = await issueLevyRun(ctx, schemeId, quarterlyScheduleId, 1);
    expect(result.issued).toBe(2);
    expect(result.dueOn).toBe("2026-07-01");

    const notices = await listNotices(ctx, schemeId);
    expect(notices).toHaveLength(2);
    // Annual 240000 / 4 instalments = 60000 per quarter, split equally: 30000 each.
    expect(notices.map((n) => n.totalCents)).toEqual([30_000, 30_000]);
    expect(notices.every((n) => n.status === "issued")).toBe(true);

    await expect(issueLevyRun(ctx, schemeId, quarterlyScheduleId, 1)).rejects.toMatchObject({
      code: "ALREADY_ISSUED",
      status: 409,
    });
  });

  it("a scheme with an adopted budget but NO lots cannot issue (422 NO_LOTS)", async () => {
    const ctx = ctxAt(T0);
    const emptyScheme = (
      await tdb.db
        .insert(schemes)
        .values({
          name: "Empty OC",
          planOfSubdivision: "PS888889E",
          addressLine1: "3 Vacant St",
          suburb: "Fitzroy",
          postcode: "3065",
          tier: 1,
          status: "active",
        })
        .returning()
    )[0]!;
    // Factory: an already-adopted budget (the adoption flow is covered above).
    const adopted = (
      await tdb.db
        .insert(budgets)
        .values({ schemeId: emptyScheme.id, fiscalYearStart: "2026-07-01", status: "adopted" })
        .returning()
    )[0]!;
    await tdb.db.insert(budgetLines).values({
      budgetId: adopted.id,
      fundKind: "admin",
      category: "general",
      description: "Administration fund",
      amountCents: 100_000,
    });

    const schedule = await createLevySchedule(ctx, emptyScheme.id, {
      budgetId: adopted.id,
      frequency: "quarterly",
      firstDueOn: "2026-07-01",
    });
    await expect(issueLevyRun(ctx, emptyScheme.id, schedule.id, 1)).rejects.toMatchObject({
      code: "NO_LOTS",
      status: 422,
    });
  });
});

let quarterlyScheduleId: string;

describe("manual payment rail permutations (partial, overpay, park, match)", () => {
  let notice1: { id: string; lotId: string; totalCents: number };
  let notice2: { id: string; lotId: string; totalCents: number };
  let parkedPaymentId: string;

  it("a partial manual payment leaves the notice partially_paid with the exact remainder", async () => {
    const ctx = ctxAt("2026-07-02T00:00:00Z");
    const notices = await listNotices(ctx, schemeId);
    notice1 = notices.find((n) => n.lotId === lotIds[0])!;
    notice2 = notices.find((n) => n.lotId === lotIds[1])!;

    const result = await recordManualPayment(ctx, schemeId, {
      levyNoticeId: notice1.id,
      amountCents: 10_000,
      paidAt: "2026-07-02",
      payerName: "Owner1 Test",
    });
    expect(result.matched).toBe(true);
    expect(result.receiptNumber).toMatch(/^R-/);

    const after = await listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === notice1.id)!.status).toBe("partially_paid");
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice1.lotId);
    expect(statement.balanceCents).toBe(20_000); // 30000 charged − 10000 paid
  });

  it("a manual payment EXCEEDING the outstanding settles the notice and leaves the lot in credit", async () => {
    const ctx = ctxAt("2026-07-03T00:00:00Z");
    const result = await recordManualPayment(ctx, schemeId, {
      levyNoticeId: notice1.id,
      amountCents: 25_000, // outstanding is only 20000
      paidAt: "2026-07-03",
    });
    expect(result.matched).toBe(true);

    const after = await listNotices(ctx, schemeId);
    expect(after.find((n) => n.id === notice1.id)!.status).toBe("paid");
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice1.lotId);
    expect(statement.balanceCents).toBe(-5_000); // credit absorbed by the next levy
  });

  it("a settled notice refuses further manual payments (422 NOTICE_NOT_OPEN)", async () => {
    const ctx = ctxAt("2026-07-04T00:00:00Z");
    await expect(
      recordManualPayment(ctx, schemeId, {
        levyNoticeId: notice1.id,
        amountCents: 1_000,
        paidAt: "2026-07-04",
      }),
    ).rejects.toMatchObject({ code: "NOTICE_NOT_OPEN", status: 422 });
  });

  it("the bank reference is an idempotency key: a re-recorded statement line never double-credits", async () => {
    const ctx = ctxAt("2026-07-05T00:00:00Z");
    const input = {
      levyNoticeId: notice2.id,
      amountCents: 5_000,
      paidAt: "2026-07-05",
      reference: "PERM-STMT-001",
    };
    const first = await recordManualPayment(ctx, schemeId, input);
    expect(first.matched).toBe(true);
    const dup = await recordManualPayment(ctx, schemeId, input);
    expect(dup.duplicate).toBe(true);

    const statement = await arrearsService.lotStatement(ctx, schemeId, notice2.lotId);
    expect(statement.balanceCents).toBe(25_000); // exactly one 5000 credit applied
  });

  it("a future-dated, unattributable manual payment is PARKED as unmatched — never guessed", async () => {
    const ctx = ctxAt("2026-07-06T00:00:00Z");
    const result = await recordManualPayment(ctx, schemeId, {
      // no levyNoticeId: the matcher runs; 777 matches no outstanding amount
      amountCents: 777,
      paidAt: "2027-01-01", // future paidAt is accepted on the manual rail
      payerName: "Mystery",
    });
    expect(result.matched).toBe(false);
    parkedPaymentId = result.paymentId;

    const rows = await listPayments(ctx, schemeId);
    const parked = rows.find((p) => p.id === parkedPaymentId)!;
    expect(parked.status).toBe("unmatched");
    expect(parked.paidAt.toISOString().slice(0, 10)).toBe("2027-01-01");
    // Nothing hit any lot ledger.
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice2.lotId);
    expect(statement.balanceCents).toBe(25_000);
  });

  it("matching permutations: settled notice 422, unknown notice/payment 404, then success exactly once", async () => {
    const ctx = ctxAt("2026-07-07T00:00:00Z");
    // → a PAID notice refuses the match
    await expect(
      matchPaymentToNotice(ctx, schemeId, parkedPaymentId, notice1.id),
    ).rejects.toMatchObject({ code: "NOTICE_NOT_OPEN", status: 422 });
    // → a notice that isn't in this scheme
    await expect(
      matchPaymentToNotice(ctx, schemeId, parkedPaymentId, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    // → a payment id that doesn't exist
    await expect(
      matchPaymentToNotice(ctx, schemeId, randomUUID(), notice2.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // → the real match applies the identical allocation/receipt chain
    const result = await matchPaymentToNotice(ctx, schemeId, parkedPaymentId, notice2.id);
    expect(result.matched).toBe(true);
    expect(result.receiptNumber).toMatch(/^R-/);
    const statement = await arrearsService.lotStatement(ctx, schemeId, notice2.lotId);
    expect(statement.balanceCents).toBe(25_000 - 777);

    // → a second match of the same payment is refused (409), balance untouched
    await expect(
      matchPaymentToNotice(ctx, schemeId, parkedPaymentId, notice2.id),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_UNMATCHED", status: 409 });
    const statement2 = await arrearsService.lotStatement(ctx, schemeId, notice2.lotId);
    expect(statement2.balanceCents).toBe(25_000 - 777);
  });
});

describe("arrears read model agrees with the deterministic interest engine", () => {
  it("shows only the indebted lot, with LEDGER-derived figures (no phantom interest)", async () => {
    // Due 2026-07-01; clock at +31 days. Lot 1 sits in CREDIT (overpaid) so it
    // must NOT appear; lot 2 owes 30000 − 5000 − 777 = 24223.
    const ctx = ctxAt("2026-08-01T00:00:00Z");
    const arrears = await arrearsService.arrearsForScheme(ctx, schemeId);
    expect(arrears).toHaveLength(1);
    const row = arrears[0]!;
    expect(row.lotId).toBe(lotIds[1]);
    expect(row.outstandingCents).toBe(24_223);
    expect(row.daysOverdue).toBe(31);
    expect(row.stage).toBe(3); // ≥30 days → final notice
    // Every quoted figure is LEDGER-derived: no interest has been posted yet
    // (the sweep hasn't run), so none is quoted — the read model never shows
    // an amount an owner couldn't actually settle against the ledger.
    expect(row.interestAccruedCents).toBe(0);
    const statement = await arrearsService.lotStatement(ctx, schemeId, row.lotId);
    expect(row.outstandingCents + row.interestAccruedCents).toBe(statement.balanceCents);
  });

  it("scanArrears flips the notice to overdue, POSTS interest per the engine, and emits stage 3 exactly once", async () => {
    const ctx = ctxAt("2026-08-01T00:00:00Z", systemActor("cron"));
    await authoriseInterest(ctx, schemeId, {
      motionId: adoptionMotionId,
      rateBps: 1_000,
      effectiveFrom: "2026-07-01",
    });
    const scan = await arrearsService.scanArrears(ctx, schemeId);
    expect(scan.emitted).toEqual([{ lotId: lotIds[1], stage: 3 }]);

    const notices = await listNotices(ctx, schemeId);
    expect(notices.find((n) => n.lotId === lotIds[1])!.status).toBe("overdue");

    // The sweep posted penalty interest to the lot ledger EXACTLY per the
    // engine (10% pa, actual/365; default settings penaltyInterestBps 1000,
    // interestGraceDays 0) on the 24223 principal over 31 days.
    const expected = interestAccrued(24_223, 1_000, 31, 0);
    expect(expected).toBe(Math.round((24_223 * 1_000 * 31) / (10_000 * 365))); // = 206
    expect(expected).toBe(206);
    expect(scan.interestPosted).toEqual([{ lotId: lotIds[1], amountCents: expected }]);

    const statement = await arrearsService.lotStatement(ctx, schemeId, lotIds[1]!);
    const interestEntries = statement.entries.filter((e) => e.kind === "interest");
    expect(interestEntries).toHaveLength(1);
    expect(interestEntries[0]!.amountCents).toBe(expected);
    expect(statement.balanceCents).toBe(24_223 + expected);

    // The read model now quotes the posted interest — and the quoted total is
    // exactly the statement balance an owner would pay.
    const arrears = await arrearsService.arrearsForScheme(ctx, schemeId);
    expect(arrears[0]!.outstandingCents).toBe(24_223);
    expect(arrears[0]!.interestAccruedCents).toBe(expected);

    // Idempotent within the same stage AND the same day: no second stage
    // event, no double-posted interest.
    const again = await arrearsService.scanArrears(ctx, schemeId);
    expect(again.emitted).toHaveLength(0);
    expect(again.interestPosted).toHaveLength(0);
    const statement2 = await arrearsService.lotStatement(ctx, schemeId, lotIds[1]!);
    expect(statement2.balanceCents).toBe(24_223 + expected);
  });
});
