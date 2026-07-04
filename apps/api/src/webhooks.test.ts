import { randomUUID } from "node:crypto";
import {
  budgets,
  funds,
  levyNoticeLines,
  levyNotices,
  levySchedules,
  lotLedgerEntries,
  lots,
  payments,
  schemes,
  webhookEvents,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { systemClock } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "./deps.js";
import { buildServiceContextFactory } from "./deps.js";
import { paymentWebhookRoutes } from "./webhooks.js";

/**
 * Route-level webhook delivery contract: signature gating, idempotency, and —
 * critically — that a delivery which FAILED to process is healed by the
 * provider's retry instead of being swallowed as a "duplicate" (money loss).
 */

let tdb: TestDatabase;
let app: Hono;
let schemeId: string;
let lotId: string;

const provider = mockPaymentsProvider();
const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: provider,
};

function deliver(body: string, signature?: string) {
  return app.request("/webhooks/payments/mock", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-signature": signature } : {}),
    },
    body,
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  // Only the slice of AppDeps the webhook route touches.
  const deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;
  app = new Hono().route("/webhooks", paymentWebhookRoutes(deps));

  // Minimal money fixture: one scheme, one lot, one open notice with a PayID.
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Webhook OC",
      planOfSubdivision: "PS300001W",
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
  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 })
    .returning();
  lotId = lotRows[0]!.id;

  const budgetRows = await tdb.db
    .insert(budgets)
    .values({ schemeId, fiscalYearStart: "2026-07-01", status: "adopted" })
    .returning();
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

  const noticeRows = await tdb.db
    .insert(levyNotices)
    .values({
      schemeId,
      lotId,
      levyScheduleId: scheduleRows[0]!.id,
      instalment: 1,
      noticeNumber: "LN-2026-01-1",
      issuedAt: new Date("2026-06-01T00:00:00Z"),
      dueOn: "2026-07-01",
      totalCents: 50_000,
      status: "issued",
      payid: "gs-webhook-notice-1",
    })
    .returning();
  await tdb.db.insert(levyNoticeLines).values({
    levyNoticeId: noticeRows[0]!.id,
    fundKind: "admin",
    description: "Administration fund levy",
    amountCents: 50_000,
  });
  await tdb.db.insert(lotLedgerEntries).values({
    schemeId,
    lotId,
    kind: "levy_charge",
    amountCents: 50_000,
    levyNoticeId: noticeRows[0]!.id,
    effectiveOn: "2026-06-01",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("payment webhook route", () => {
  it("rejects a bad signature with 401 and records the delivery", async () => {
    const body = provider.buildWebhookBody({
      payid: "gs-webhook-notice-1",
      amountCents: 50_000,
      paidAt: "2026-06-05T00:00:00Z",
      payerName: "Pat",
    });
    const res = await deliver(body, "0".repeat(64));
    expect(res.status).toBe(401);

    const rows = await tdb.db.query.webhookEvents.findMany({
      where: eq(webhookEvents.signatureValid, false),
    });
    expect(rows.length).toBeGreaterThan(0);
    // And no money moved.
    const paid = await tdb.db.query.payments.findMany({
      where: eq(payments.schemeId, schemeId),
    });
    expect(paid).toHaveLength(0);
  });

  it("rejects an unknown provider path", async () => {
    const res = await app.request("/webhooks/payments/stripe", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  it("processes a signed payment end-to-end and absorbs true replays", async () => {
    const body = provider.buildWebhookBody({
      providerRef: `wh-${randomUUID()}`,
      payid: "gs-webhook-notice-1",
      amountCents: 20_000,
      paidAt: "2026-06-05T00:00:00Z",
      payerName: "Pat Owner",
    });
    const sig = provider.sign(body);

    const res = await deliver(body, sig);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: true });

    // Delivery stamped processed; replay is a no-op.
    const parsed = provider.parseWebhook(body);
    const event = await tdb.db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, "mock"),
        eq(webhookEvents.providerEventId, parsed.providerRef),
      ),
    });
    expect(event?.processedAt).not.toBeNull();

    const replay = await deliver(body, sig);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
    const paid = await tdb.db.query.payments.findMany({
      where: and(eq(payments.schemeId, schemeId), eq(payments.providerRef, parsed.providerRef)),
    });
    expect(paid).toHaveLength(1); // never double-credited
  });

  it("parks an unattributable payment and HEALS it on the provider's retry", async () => {
    // A payment whose reference no scheme knows yet — e.g. the webhook raced
    // ahead of levy issuance. It must be acked (parked), NOT lost.
    const futurePayid = `gs-early-${randomUUID()}`;
    const body = provider.buildWebhookBody({
      providerRef: `wh-early-${randomUUID()}`,
      payid: futurePayid,
      amountCents: 30_000,
      paidAt: "2026-06-06T00:00:00Z",
      payerName: "Early Bird",
    });
    const sig = provider.sign(body);
    const parsed = provider.parseWebhook(body);

    const first = await deliver(body, sig);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, parked: true });

    // The delivery is on the ledger, unprocessed — visible, not dropped.
    const event = await tdb.db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, "mock"),
        eq(webhookEvents.providerEventId, parsed.providerRef),
      ),
    });
    expect(event).toBeTruthy();
    expect(event!.processedAt).toBeNull();

    // The reference now comes into existence (levy issued with that PayID).
    await tdb.db
      .insert(levyNotices)
      .values({
        schemeId,
        lotId,
        levyScheduleId: (await tdb.db.query.levySchedules.findMany())[0]!.id,
        instalment: 2,
        noticeNumber: "LN-2026-02-1",
        issuedAt: new Date("2026-06-06T00:00:00Z"),
        dueOn: "2026-10-01",
        totalCents: 30_000,
        status: "issued",
        payid: futurePayid,
      })
      .returning();

    // Provider retry of the SAME delivery: previously this was swallowed as a
    // "duplicate" and the money silently lost; now it reprocesses and matches.
    const retry = await deliver(body, sig);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ ok: true, matched: true, duplicate: false });

    const healed = await tdb.db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.provider, "mock"),
        eq(webhookEvents.providerEventId, parsed.providerRef),
      ),
    });
    expect(healed!.processedAt).not.toBeNull();

    // …and a third delivery is now a true replay.
    const third = await deliver(body, sig);
    expect(await third.json()).toMatchObject({ ok: true, duplicate: true });
    const paid = await tdb.db.query.payments.findMany({
      where: and(eq(payments.schemeId, schemeId), eq(payments.providerRef, parsed.providerRef)),
    });
    expect(paid).toHaveLength(1);
  });

  it("acks-but-rejects an invalid amount without booking anything", async () => {
    const body = provider.buildWebhookBody({
      providerRef: `wh-bad-${randomUUID()}`,
      payid: "gs-webhook-notice-1",
      amountCents: -500,
      paidAt: "2026-06-07T00:00:00Z",
      payerName: "Negative Nancy",
    });
    const res = await deliver(body, provider.sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rejected: true });

    const parsed = provider.parseWebhook(body);
    const paid = await tdb.db.query.payments.findMany({
      where: eq(payments.providerRef, parsed.providerRef),
    });
    expect(paid).toHaveLength(0);
  });

  it("rejects an unparseable-but-signed payload with 400", async () => {
    const body = "not-json";
    const res = await deliver(body, provider.sign(body));
    expect(res.status).toBe(400);
  });
});
