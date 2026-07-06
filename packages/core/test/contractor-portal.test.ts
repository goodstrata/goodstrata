import { lots, memberships, people, rfqChannels, schemes, users, workOrders } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, toDateOnly, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as maintenanceService from "../src/services/maintenance.js";
import * as notificationsService from "../src/services/notifications.js";
import * as tradeRfqService from "../src/services/tradeRfq.js";

let tdb: TestDatabase;
let schemeId: string;
let contractorId: string;
let lotId: string;
let reporterPersonId: string;
const officerUserId = "user-officer-portal";

const SCHEME_NAME = "Portal Test OC";
const STREET_ADDRESS = "42 Privacy Lane";
const OWNER_EMAIL = "olive.owner@example.com";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
  TRADE_MARKET_PROVIDERS: "scheme_book,email_rfq,console",
});

function ctx(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock("2026-07-02T00:00:00Z"), integrations, actor };
}

async function newTriagedRequest(description: string) {
  const c = ctx();
  const request = await maintenanceService.createMaintenanceRequest(c, schemeId, {
    title: `Job ${Math.random().toString(36).slice(2, 8)}`,
    description,
    lotId,
    reportedByPersonId: reporterPersonId,
  });
  await maintenanceService.applyTriage(c, schemeId, request.id, {
    category: "plumbing",
    urgency: "routine",
    isCommonProperty: true,
    reasoning: "test",
  });
  return request;
}

/** A dispatched RFQ ready to take quotes, plus the per-recipient tokens. */
async function newQuotingRfq(opts?: { invitedEmails?: string[]; contractorIds?: string[] }) {
  const request = await newTriagedRequest("Water hammer in the common riser.");
  const rfq = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
    requestId: request.id,
  });
  await tradeRfqService.dispatchRfq(ctx(), schemeId, rfq.id, {
    contractorIds: opts?.contractorIds ?? (opts?.invitedEmails ? [] : [contractorId]),
    invitedEmails: opts?.invitedEmails ?? [],
    broadcastProviders: [],
  });
  const channels = await tdb.db.query.rfqChannels.findMany({
    where: eq(rfqChannels.rfqId, rfq.id),
  });
  return { rfq, channels };
}

/** Drive a full award so a dispatched work order (with an accept token) exists. */
async function newDispatchedWorkOrder() {
  const { rfq } = await newQuotingRfq();
  const quote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
    contractorId,
    amountCents: 88_000,
    licenceConfirmed: true,
    insuranceConfirmed: true,
    platformFeeCents: 0,
    referralFeeCents: 0,
  });
  const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, quote.id);
  const c = ctx(userActor(officerUserId));
  await decisionsService.resolveDecision(c, schemeId, decisionId, "approve", ["chair"]);
  await decisionsService.executeDecisionFollowUp(ctx(), decisionId);
  const wo = await tdb.db.query.workOrders.findFirst({ where: eq(workOrders.quoteId, quote.id) });
  return { rfq, quote, wo: wo!, decisionId };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: SCHEME_NAME,
      planOfSubdivision: "PS777001R",
      addressLine1: STREET_ADDRESS,
      suburb: "Brunswick",
      postcode: "3056",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(users).values({ id: officerUserId, name: "Chair", email: "chair@x.com" });
  // A chair membership so decline notifications have a recipient.
  await tdb.db.insert(memberships).values({
    schemeId,
    userId: officerUserId,
    role: "chair",
    startedOn: toDateOnly(new Date("2026-01-01T00:00:00Z")),
  });

  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "9", entitlement: 1, liability: 1 })
    .returning();
  lotId = lotRows[0]!.id;

  const personRows = await tdb.db
    .insert(people)
    .values({ schemeId, givenName: "Olive", familyName: "Owner", email: OWNER_EMAIL })
    .returning();
  reporterPersonId = personRows[0]!.id;

  const contractor = await maintenanceService.createContractor(ctx(), schemeId, {
    businessName: "Brunswick Plumbing Co",
    email: "jobs@brunswickplumbing.example",
    tradeCategories: ["plumbing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("quote token — read side", () => {
  it("resolves the token to exactly this rfq + suburb + scope, never an address", async () => {
    const { rfq, channels } = await newQuotingRfq();
    const token = channels[0]!.quoteToken!;
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThanOrEqual(24);

    const preview = await tradeRfqService.getRfqByQuoteToken(ctx(), token);
    expect(preview.title).toBe(rfq.title);
    expect(preview.suburb).toBe("Brunswick");
    expect(preview.category).toBe("plumbing");
    expect(preview.hasContractor).toBe(true);
    expect(preview.businessName).toBe("Brunswick Plumbing Co");
    // Address confidentiality: nothing in the preview exposes the street.
    expect(JSON.stringify(preview)).not.toContain(STREET_ADDRESS);
    expect(preview).not.toHaveProperty("address");
    // Scope rendered to safe HTML.
    expect(preview.scopeHtml).toContain("<");
  });

  it("an unknown token is a neutral 404 with no oracle", async () => {
    await expect(
      tradeRfqService.getRfqByQuoteToken(ctx(), "totally-invalid-token-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("quote token — submit", () => {
  it("records the quote against THAT contractor + rfq and marks the channel responded", async () => {
    const { rfq, channels } = await newQuotingRfq();
    const token = channels[0]!.quoteToken!;

    const quote = await tradeRfqService.submitQuoteByToken(ctx(), token, {
      amountCents: 75_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });

    expect(quote.contractorId).toBe(contractorId);
    expect(quote.rfqId).toBe(rfq.id);
    expect(quote.channelId).toBe(channels[0]!.id);
    expect(quote.amountCents).toBe(75_000);

    const channel = await tdb.db.query.rfqChannels.findFirst({
      where: eq(rfqChannels.id, channels[0]!.id),
    });
    expect(channel!.status).toBe("responded");
  });

  it("an invited-email token mints a pending contractor from the form contact", async () => {
    const { channels } = await newQuotingRfq({ invitedEmails: ["newtradie@outside.example"] });
    const token = channels[0]!.quoteToken!;
    const preview = await tradeRfqService.getRfqByQuoteToken(ctx(), token);
    expect(preview.hasContractor).toBe(false);
    expect(preview.businessName).toBeNull();

    const quote = await tradeRfqService.submitQuoteByToken(ctx(), token, {
      contact: { businessName: "Outside Plumbing", email: "newtradie@outside.example" },
      amountCents: 60_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const contractor = await tdb.db.query.contractors.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, quote.contractorId),
    });
    expect(contractor!.status).toBe("pending");
    expect(contractor!.businessName).toBe("Outside Plumbing");
  });

  it("still enforces zero-hidden-margin: a fee without a recipient is rejected", async () => {
    const { channels } = await newQuotingRfq();
    const token = channels[0]!.quoteToken!;
    await expect(
      tradeRfqService.submitQuoteByToken(ctx(), token, {
        amountCents: 50_000,
        licenceConfirmed: true,
        insuranceConfirmed: true,
        platformFeeCents: 5_000,
        referralFeeCents: 0,
        // feeRecipient deliberately omitted
      }),
    ).rejects.toMatchObject({ code: "FEE_UNDISCLOSED", status: 422 });
  });

  it("rejects a non-positive amount", async () => {
    const { channels } = await newQuotingRfq();
    const token = channels[0]!.quoteToken!;
    await expect(
      tradeRfqService.submitQuoteByToken(ctx(), token, {
        amountCents: 0,
        licenceConfirmed: true,
        insuranceConfirmed: true,
        platformFeeCents: 0,
        referralFeeCents: 0,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("is one-quote-per-channel: a second submission is refused", async () => {
    const { channels } = await newQuotingRfq();
    const token = channels[0]!.quoteToken!;
    await tradeRfqService.submitQuoteByToken(ctx(), token, {
      amountCents: 42_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    await expect(
      tradeRfqService.submitQuoteByToken(ctx(), token, {
        amountCents: 43_000,
        licenceConfirmed: true,
        insuranceConfirmed: true,
        platformFeeCents: 0,
        referralFeeCents: 0,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_QUOTED", status: 409 });
  });
});

describe("work-order accept token", () => {
  it("reveals the full address (post-award) and the approved amount", async () => {
    const { wo } = await newDispatchedWorkOrder();
    expect(wo.status).toBe("dispatched");
    const token = wo.acceptToken!;
    expect(token).toBeTruthy();

    const preview = await tradeRfqService.getWorkOrderByAcceptToken(ctx(), token);
    expect(preview.address).toContain(STREET_ADDRESS);
    expect(preview.location).toBe("Lot 9");
    expect(preview.approvedAmountCents).toBe(88_000);
    expect(preview.approvedAmountFormatted).toBe("$880.00");
  });

  it("accept flips dispatched → accepted and awards NOTHING new", async () => {
    const { rfq, quote, wo } = await newDispatchedWorkOrder();
    const token = wo.acceptToken!;

    const result = await tradeRfqService.acceptWorkOrderByToken(ctx(), token);
    expect(result.status).toBe("accepted");

    const after = await tdb.db.query.workOrders.findFirst({
      where: eq(workOrders.id, wo.id),
    });
    expect(after!.status).toBe("accepted");
    // Award invariants untouched: still exactly one WO, amount verbatim, quote selected.
    expect(after!.approvedAmountCents).toBe(88_000);
    const { rfq: rfqAfter, quotes } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(rfqAfter.awardedQuoteId).toBe(quote.id);
    expect(quotes.find((q) => q.quoteId === quote.id)!.status).toBe("selected");
    const allForQuote = await tdb.db.query.workOrders.findMany({
      where: eq(workOrders.quoteId, quote.id),
    });
    expect(allForQuote).toHaveLength(1);

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.type, "work_order.accepted"),
    });
    expect(events.some((e) => (e.payload as { workOrderId?: string }).workOrderId === wo.id)).toBe(
      true,
    );
  });

  it("accept is idempotent — a second call is a no-op", async () => {
    const { wo } = await newDispatchedWorkOrder();
    const token = wo.acceptToken!;
    await tradeRfqService.acceptWorkOrderByToken(ctx(), token);
    const again = await tradeRfqService.acceptWorkOrderByToken(ctx(), token);
    expect(again.status).toBe("accepted");
  });

  it("decline cancels the work order and notifies the officers", async () => {
    const { wo } = await newDispatchedWorkOrder();
    const token = wo.acceptToken!;

    const result = await tradeRfqService.declineWorkOrderByToken(ctx(), token);
    expect(result.status).toBe("cancelled");

    const after = await tdb.db.query.workOrders.findFirst({ where: eq(workOrders.id, wo.id) });
    expect(after!.status).toBe("cancelled");

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.type, "work_order.declined"),
    });
    expect(events.some((e) => (e.payload as { workOrderId?: string }).workOrderId === wo.id)).toBe(
      true,
    );

    const notes = await notificationsService.listNotifications(ctx(), schemeId, officerUserId);
    expect(
      notes.some(
        (n) => (n.related as { id?: string } | null)?.id === wo.id && n.category === "maintenance",
      ),
    ).toBe(true);
  });

  it("an unknown accept token is a neutral 404", async () => {
    await expect(
      tradeRfqService.getWorkOrderByAcceptToken(ctx(), "totally-invalid-token-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
