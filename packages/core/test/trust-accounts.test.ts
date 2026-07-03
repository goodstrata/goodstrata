import {
  budgetLines,
  budgets,
  funds,
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

let tdb: TestDatabase;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const T0 = "2026-06-01T00:00:00Z";
function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso) as Clock, integrations, actor };
}

interface Seeded {
  schemeId: string;
  scheduleId: string;
}

/** A minimal but complete scheme: adopted budget, one lot+owner, a levy schedule. */
async function seedScheme(name: string, plan: string): Promise<Seeded> {
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

  return { schemeId, scheduleId: scheduleRows[0]!.id };
}

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  a = await seedScheme("Trust OC A", "PS100001A");
  b = await seedScheme("Trust OC B", "PS100002B");
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("per-OC trust accounts (OC Act s 122)", () => {
  it("provisions a DISTINCT segregated account per scheme, idempotently", async () => {
    const ctx = ctxAt(T0);

    const acctA = await trustAccountsService.ensureSchemeTrustAccount(ctx, a.schemeId);
    const acctB = await trustAccountsService.ensureSchemeTrustAccount(ctx, b.schemeId);

    // Segregated: different account row, id, provider account, and number.
    expect(acctA.id).not.toBe(acctB.id);
    expect(acctA.providerAccountId).not.toBe(acctB.providerAccountId);
    expect(acctA.accountNumber).not.toBe(acctB.accountNumber);
    expect(acctA.kind).toBe("virtual_collection");
    expect(acctA.status).toBe("active");
    expect(acctA.schemeId).toBe(a.schemeId);

    // Idempotent: the UNIQUE (schemeId, kind) index returns the same row.
    const again = await trustAccountsService.ensureSchemeTrustAccount(ctx, a.schemeId);
    expect(again.id).toBe(acctA.id);

    const listed = await trustAccountsService.listBankAccounts(ctx, a.schemeId);
    expect(listed).toHaveLength(1);
  });

  it("issues levies with references registered UNDER the scheme's own account", async () => {
    const ctx = ctxAt(T0);
    await leviesService.issueLevyRun(ctx, a.schemeId, a.scheduleId, 1);
    await leviesService.issueLevyRun(ctx, b.schemeId, b.scheduleId, 1);

    const acctA = (await trustAccountsService.getSchemeTrustAccount(ctx, a.schemeId))!;
    const acctB = (await trustAccountsService.getSchemeTrustAccount(ctx, b.schemeId))!;

    const noticeA = (await leviesService.listNotices(ctx, a.schemeId))[0]!;
    const noticeB = (await leviesService.listNotices(ctx, b.schemeId))[0]!;

    // Each PayID encodes its own scheme's account — no shared pool, no collision.
    expect(noticeA.payid).toContain(acctA.providerAccountId);
    expect(noticeB.payid).toContain(acctB.providerAccountId);
    expect(noticeA.payid).not.toBe(noticeB.payid);
  });

  it("reconciles a payment ONLY against its own scheme's account", async () => {
    const ctx = ctxAt("2026-06-05T00:00:00Z");
    const provider = integrations.payments;
    const noticeA = (await leviesService.listNotices(ctx, a.schemeId))[0]!;

    const body = provider.buildWebhookBody({
      payid: noticeA.payid!,
      amountCents: noticeA.totalCents,
      paidAt: "2026-06-05T00:00:00Z",
      payerName: "Pat Owner",
    });
    const result = await paymentsService.recordInboundPayment(
      ctx,
      "mock",
      provider.parseWebhook(body),
    );

    expect(result.matched).toBe(true);
    expect(result.levyNoticeId).toBe(noticeA.id);

    // The payment landed on scheme A's ledger — and NOTHING on scheme B's.
    const payA = await tdb.db.query.payments.findMany({
      where: eq(payments.schemeId, a.schemeId),
    });
    const payB = await tdb.db.query.payments.findMany({
      where: eq(payments.schemeId, b.schemeId),
    });
    expect(payA).toHaveLength(1);
    expect(payA[0]!.status).toBe("matched");
    expect(payB).toHaveLength(0);

    // Scheme B's notice is untouched.
    const noticeB = (await leviesService.listNotices(ctx, b.schemeId))[0]!;
    expect(noticeB.status).toBe("issued");
  });
});
