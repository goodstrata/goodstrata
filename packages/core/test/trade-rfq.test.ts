import { lots, people, schemes, users, workOrders } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import {
  integrationsFromEnv,
  type RfqPosting,
  type RfqRecipient,
  type TradeMarketProvider,
} from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as maintenanceService from "../src/services/maintenance.js";
import * as tradeRfqService from "../src/services/tradeRfq.js";

let tdb: TestDatabase;
let schemeId: string;
let contractorId: string;
let lotId: string;
let reporterPersonId: string;
const managerUserId = "user-mgr-rfq";

// PII planted in the fixtures — every one of these strings must be absent
// from anything that leaves the platform pre-award.
const SCHEME_NAME = "Hidden Address OC";
const STREET_ADDRESS = "42 Privacy Lane";
const PLAN_NUMBER = "PS777001R";
const OWNER_EMAIL = "olive.owner@example.com";
const OWNER_PHONE = "0412 345 678";
const LOT_NUMBER = "9";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
  TRADE_MARKET_PROVIDERS: "scheme_book,email_rfq,console",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};
const consoleMarket = integrations.tradeMarkets.find(
  (p) => p.name === "console",
) as TradeMarketProvider & {
  posted: { posting: RfqPosting; recipients: RfqRecipient[] }[];
};

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

/** A dispatched RFQ ready to take quotes. */
async function newQuotingRfq() {
  const request = await newTriagedRequest("Water hammer in the common riser.");
  const rfq = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
    requestId: request.id,
  });
  await tradeRfqService.dispatchRfq(ctx(), schemeId, rfq.id, {
    contractorIds: [contractorId],
    invitedEmails: [],
    broadcastProviders: [],
  });
  return rfq;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: SCHEME_NAME,
      planOfSubdivision: PLAN_NUMBER,
      addressLine1: STREET_ADDRESS,
      suburb: "Brunswick",
      postcode: "3056",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(users).values({ id: managerUserId, name: "M", email: "mgr@x.com" });

  const lotRows = await tdb.db
    .insert(lots)
    .values({
      schemeId,
      lotNumber: LOT_NUMBER,
      entitlement: 1,
      liability: 1,
      streetAddress: `${LOT_NUMBER}/${STREET_ADDRESS}`,
    })
    .returning();
  lotId = lotRows[0]!.id;

  const personRows = await tdb.db
    .insert(people)
    .values({
      schemeId,
      givenName: "Olive",
      familyName: "Owner",
      email: OWNER_EMAIL,
      phone: OWNER_PHONE,
    })
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

describe("anonymization is enforced in code", () => {
  it("strips owner names, contacts, address, plan and lot numbers from the drafted spec", async () => {
    const request = await newTriagedRequest(
      `Water hammer in the walls of ${SCHEME_NAME}. Contact Olive Owner on ${OWNER_PHONE} ` +
        `or ${OWNER_EMAIL} at ${STREET_ADDRESS}, lot ${LOT_NUMBER} (plan ${PLAN_NUMBER}).`,
    );
    const rfq = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
      requestId: request.id,
    });

    const spec = rfq.specMd.toLowerCase();
    expect(spec).not.toContain(STREET_ADDRESS.toLowerCase());
    expect(spec).not.toContain(OWNER_EMAIL);
    expect(spec).not.toContain(OWNER_PHONE);
    expect(spec).not.toContain("olive");
    expect(spec).not.toContain("owner ");
    expect(spec).not.toContain(`lot ${LOT_NUMBER}`);
    expect(spec).not.toContain(PLAN_NUMBER.toLowerCase());
    expect(spec).not.toContain(SCHEME_NAME.toLowerCase());
    // What IS allowed out: suburb-level location and the scope itself.
    expect(rfq.suburb).toBe("Brunswick");
    expect(rfq.specMd).toContain("Brunswick");
    expect(rfq.specMd).toContain("Water hammer");
    expect(rfq.specMd).toContain("[redacted]");
  });

  it("re-scrubs an agent/officer-edited spec before it is stored", async () => {
    const request = await newTriagedRequest("Leaking valve on the common riser.");
    const rfq = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
      requestId: request.id,
    });
    const updated = await tradeRfqService.applyRfqSpec(ctx(), schemeId, rfq.id, {
      title: "Riser valve replacement",
      specMd: `Replace the failed valve. Site contact: Olive Owner, ${OWNER_PHONE}, at ${STREET_ADDRESS}.`,
      category: "plumbing",
    });
    expect(updated.specMd).not.toContain(STREET_ADDRESS);
    expect(updated.specMd).not.toContain(OWNER_PHONE);
    expect(updated.specMd).not.toContain("Olive");
    expect(updated.specMd).toContain("Replace the failed valve");
  });

  it("the outbound posting is built from RFQ columns only — no address/person/lot fields exist on it", async () => {
    const request = await newTriagedRequest(
      `Blocked stormwater drain at ${STREET_ADDRESS}, call ${OWNER_EMAIL}.`,
    );
    const rfq = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
      requestId: request.id,
    });
    memoryEmail.sent.length = 0;
    consoleMarket.posted.length = 0;

    const result = await tradeRfqService.dispatchRfq(ctx(), schemeId, rfq.id, {
      contractorIds: [contractorId],
      invitedEmails: ["tradie@outside.example"],
      broadcastProviders: ["console"],
    });
    expect(result.channelsSent).toBe(3);
    expect(result.channelsFailed).toBe(0);

    // Structural check: the posting struct has EXACTLY the whitelisted fields.
    expect(consoleMarket.posted).toHaveLength(1);
    const posting = consoleMarket.posted[0]!.posting;
    expect(Object.keys(posting).sort()).toEqual([
      "buildingType",
      "category",
      "quotesDueOn",
      "replyRef",
      "rfqId",
      "scopeMd",
      "suburb",
      "title",
    ]);
    const wire = JSON.stringify(posting);
    expect(wire).not.toContain(STREET_ADDRESS);
    expect(wire).not.toContain(OWNER_EMAIL);
    expect(wire).not.toContain(SCHEME_NAME);
    expect(posting.suburb).toBe("Brunswick");

    // The emails that actually left carry suburb + scope, never the address.
    expect(memoryEmail.sent).toHaveLength(2);
    for (const sent of memoryEmail.sent) {
      expect(sent.text).toContain("Brunswick");
      expect(sent.text).not.toContain(STREET_ADDRESS);
      expect(sent.text).not.toContain(OWNER_EMAIL);
    }

    // Channels recorded per send; request flipped to quoting.
    const { rfq: after, channels } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(after.status).toBe("published");
    expect(channels).toHaveLength(3);
    expect(channels.every((c) => c.status === "sent")).toBe(true);
    expect(channels.map((c) => c.provider).sort()).toEqual(["console", "email_rfq", "scheme_book"]);
    const requests = await maintenanceService.listRequests(ctx(), schemeId);
    expect(requests.find((r) => r.id === request.id)!.status).toBe("quoting");
  });
});

describe("quotes-due date coercion (the DATE column never sees junk)", () => {
  it("coerces non-date quotesDueOn to null instead of failing the query", async () => {
    // Repro of the prod loop: the scope-drafter agent emitted "", "Not set" and
    // a full ISO datetime into the DATE column, which Postgres rejected.
    // On CREATE (no prior value) any non-date reduces to null.
    const r1 = await newTriagedRequest("Dog mess in the common lobby.");
    const empty = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
      requestId: r1.id,
      quotesDueOn: "",
    });
    expect(empty.quotesDueOn).toBeNull();

    const r2 = await newTriagedRequest("Broken common gate latch.");
    const impossible = await tradeRfqService.createRfqFromRequest(ctx(), schemeId, {
      requestId: r2.id,
      quotesDueOn: "2026-02-30", // Feb 30 never exists
    });
    expect(impossible.quotesDueOn).toBeNull();

    const spec = {
      title: "Lobby clean-down",
      specMd: "Clean and disinfect the affected common-area floor thoroughly.",
      category: "cleaning",
    };

    // A real date lands as date-only, even when supplied as a full ISO datetime.
    const dated = await tradeRfqService.applyRfqSpec(ctx(), schemeId, empty.id, {
      ...spec,
      quotesDueOn: "2026-07-20T00:00:00.000Z",
    });
    expect(dated.quotesDueOn).toBe("2026-07-20");

    // A non-date on a later edit keeps the existing date rather than crashing
    // or wiping it.
    const kept = await tradeRfqService.applyRfqSpec(ctx(), schemeId, empty.id, {
      ...spec,
      quotesDueOn: "Not set",
    });
    expect(kept.quotesDueOn).toBe("2026-07-20");
  });
});

describe("fees always surface (zero hidden margin)", () => {
  it("rejects a nonzero fee without a named recipient", async () => {
    const rfq = await newQuotingRfq();
    await expect(
      tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
        contractorId,
        amountCents: 50_000,
        licenceConfirmed: false,
        insuranceConfirmed: false,
        platformFeeCents: 2_500,
        referralFeeCents: 0,
      }),
    ).rejects.toThrow(/fee recipient/i);
  });

  it("carries fee fields through the comparison, the event log and the decision summary", async () => {
    const rfq = await newQuotingRfq();
    await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 90_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const feeQuote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contact: { businessName: "MarketTrade Plumbers", email: "quotes@markettrade.example" },
      amountCents: 80_000,
      licenceConfirmed: true,
      insuranceConfirmed: false,
      platformFeeCents: 2_500,
      referralFeeCents: 1_500,
      feeRecipient: "TradeMarket Pty Ltd",
    });

    // Comparison rows always include the fee columns, sorted cheapest first.
    const comparison = await tradeRfqService.compareQuotes(ctx(), schemeId, rfq.id);
    expect(comparison.quotes).toHaveLength(2);
    expect(comparison.quotes[0]!.amountCents).toBe(80_000);
    expect(comparison.quotes[0]!.feeDisclosure).toBe(
      "$25.00 platform + $15.00 referral → TradeMarket Pty Ltd",
    );
    expect(comparison.quotes[1]!.feeDisclosure).toBe("none");
    expect(comparison.summaryMd).toContain("$25.00 platform");
    expect(comparison.summaryMd).toContain("$15.00 referral");
    expect(comparison.summaryMd).toContain("TradeMarket Pty Ltd");
    expect(comparison.summaryMd).toContain("none");

    // The quote.received event carries the fees unconditionally.
    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.type, "quote.received"),
    });
    const feeEvent = events.find(
      (e) => (e.payload as { quoteId?: string }).quoteId === feeQuote.id,
    );
    expect(feeEvent).toBeDefined();
    expect(feeEvent!.payload).toMatchObject({
      platformFeeCents: 2_500,
      referralFeeCents: 1_500,
      feeRecipient: "TradeMarket Pty Ltd",
    });

    // And the committee decision summary renders the fee line.
    const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, feeQuote.id);
    const decisions = await decisionsService.listDecisions(ctx(), schemeId);
    const decision = decisions.find((d) => d.id === decisionId)!;
    expect(decision.summaryMd).toContain(
      "**Fees: $25.00 platform + $15.00 referral → TradeMarket Pty Ltd**",
    );
  });

  it("an external tradie's quote creates a pending contractor row", async () => {
    const rfq = await newQuotingRfq();
    const quote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contact: {
        businessName: "New Kid Plumbing",
        abn: "12 345 678 901",
        email: "newkid@example.com",
        phone: "0400 000 001",
      },
      amountCents: 70_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const contractor = await tdb.db.query.contractors.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, quote.contractorId),
    });
    expect(contractor!.status).toBe("pending");
    expect(contractor!.businessName).toBe("New Kid Plumbing");
  });
});

describe("award is impossible without an approved human decision", () => {
  it("the service exposes no direct award function", () => {
    // AI NEVER PICKS: awardQuote is module-private; the only entry point is
    // the decision follow-up executor.
    expect((tradeRfqService as Record<string, unknown>).awardQuote).toBeUndefined();
  });

  it("requestAward opens a pending decision and awards nothing", async () => {
    const rfq = await newQuotingRfq();
    const quote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 100_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });

    const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, quote.id);

    const decisions = await decisionsService.listDecisions(ctx(), schemeId, "pending");
    const decision = decisions.find((d) => d.id === decisionId)!;
    expect(decision.kind).toBe("quote_approval");
    expect(decision.summaryMd).toContain("Quote comparison");
    expect(decision.summaryMd).toContain("**Fees: none**");

    // Nothing awarded yet: RFQ still quoting, no work order for this quote.
    const { rfq: after } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(after.status).toBe("quoting");
    expect(after.awardedQuoteId).toBeNull();
    const orders = await tdb.db.query.workOrders.findMany({
      where: eq(workOrders.quoteId, quote.id),
    });
    expect(orders).toHaveLength(0);
  });

  it("one nomination at a time: a second requestAward 409s while the first is with the committee", async () => {
    const rfq = await newQuotingRfq();
    const first = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 110_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const second = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 90_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });

    const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, first.id);

    // The read shapes tell clients the award is with the committee…
    const { rfq: pendingRead } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(pendingRead.decisionStatus).toBe("pending");
    const listed = await tradeRfqService.listRfqs(ctx(), schemeId);
    expect(listed.find((r) => r.id === rfq.id)!.decisionStatus).toBe("pending");

    // …and the service refuses to open a second live ballot.
    await expect(
      tradeRfqService.requestAward(ctx(), schemeId, rfq.id, second.id),
    ).rejects.toMatchObject({ code: "AWARD_PENDING", status: 409 });

    // A committee decline releases the lock: nomination reopens.
    const c = ctx(userActor(managerUserId));
    await decisionsService.resolveDecision(c, schemeId, decisionId, "decline", ["chair"]);
    const { rfq: declinedRead } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(declinedRead.decisionStatus).toBe("declined");
    const renominated = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, second.id);
    expect(renominated.decisionId).not.toBe(decisionId);
  });

  it("committee approval executes the award: work order on the existing rails, address revealed only now", async () => {
    const rfq = await newQuotingRfq();
    const losing = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 120_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const winning = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contact: { businessName: "Winner Plumbing", email: "win@example.com" },
      amountCents: 95_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });

    const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, winning.id);
    memoryEmail.sent.length = 0;

    // Human approval → follow-up executor → award.
    const c = ctx(userActor(managerUserId));
    await decisionsService.resolveDecision(c, schemeId, decisionId, "approve", ["chair"]);
    await decisionsService.executeDecisionFollowUp(ctx(), decisionId);

    const { rfq: after, quotes: quoteRows } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(after.status).toBe("awarded");
    expect(after.awardedQuoteId).toBe(winning.id);
    expect(quoteRows.find((q) => q.quoteId === winning.id)!.status).toBe("selected");
    expect(quoteRows.find((q) => q.quoteId === losing.id)!.status).toBe("declined");

    // Work order on the existing rails: quoted amount copied VERBATIM.
    const orders = await tdb.db.query.workOrders.findMany({
      where: eq(workOrders.quoteId, winning.id),
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.approvedAmountCents).toBe(95_000);
    expect(orders[0]!.decisionId).toBe(decisionId);
    expect(orders[0]!.status).toBe("dispatched");

    // Winning external tradie approved; dispatch email reveals the address
    // only NOW (post-award).
    const contractor = await tdb.db.query.contractors.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, winning.contractorId),
    });
    expect(contractor!.status).toBe("approved");
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("win@example.com");
    expect(memoryEmail.sent[0]!.text).toContain(STREET_ADDRESS);

    // Executor retry is a no-op: no second work order, no second email.
    await decisionsService.executeDecisionFollowUp(ctx(), decisionId);
    const retryOrders = await tdb.db.query.workOrders.findMany({
      where: eq(workOrders.quoteId, winning.id),
    });
    expect(retryOrders).toHaveLength(1);
    expect(memoryEmail.sent).toHaveLength(1);
  });

  it("a declined decision awards nothing", async () => {
    const rfq = await newQuotingRfq();
    const quote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 60_000,
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    const { decisionId } = await tradeRfqService.requestAward(ctx(), schemeId, rfq.id, quote.id);

    const c = ctx(userActor(managerUserId));
    await decisionsService.resolveDecision(c, schemeId, decisionId, "decline", ["chair"]);
    const { executed } = await decisionsService.executeDecisionFollowUp(ctx(), decisionId);
    expect(executed).toBeNull();

    const { rfq: after } = await tradeRfqService.getRfq(ctx(), schemeId, rfq.id);
    expect(after.status).toBe("quoting");
    expect(after.awardedQuoteId).toBeNull();
  });
});

describe("money boundary cases", () => {
  it("rejects fractional, zero, negative and unsafe-integer amounts", async () => {
    const rfq = await newQuotingRfq();
    const base = {
      contractorId,
      licenceConfirmed: false,
      insuranceConfirmed: false,
      platformFeeCents: 0,
      referralFeeCents: 0,
    };
    for (const amountCents of [1234.56, 0, -500, 2 ** 53]) {
      await expect(
        tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, { ...base, amountCents }),
      ).rejects.toThrow(/integer number of cents/);
    }
    // Zod boundary matches the service guard.
    expect(tradeRfqService.recordQuoteInput.safeParse({ ...base, amountCents: 0.5 }).success).toBe(
      false,
    );
    expect(tradeRfqService.recordQuoteInput.safeParse({ ...base, amountCents: 1 }).success).toBe(
      true,
    );
  });

  it("rejects negative or fractional fees; accepts the 1-cent minimum quote", async () => {
    const rfq = await newQuotingRfq();
    await expect(
      tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
        contractorId,
        amountCents: 10_000,
        licenceConfirmed: false,
        insuranceConfirmed: false,
        platformFeeCents: -100,
        referralFeeCents: 0,
        feeRecipient: "Nobody",
      }),
    ).rejects.toThrow(/integer number of cents/);
    await expect(
      tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
        contractorId,
        amountCents: 10_000,
        licenceConfirmed: false,
        insuranceConfirmed: false,
        platformFeeCents: 0,
        referralFeeCents: 0.5,
        feeRecipient: "Nobody",
      }),
    ).rejects.toThrow(/integer number of cents/);

    const quote = await tradeRfqService.recordQuote(ctx(), schemeId, rfq.id, {
      contractorId,
      amountCents: 1,
      licenceConfirmed: false,
      insuranceConfirmed: false,
      platformFeeCents: 0,
      referralFeeCents: 0,
    });
    expect(quote.amountCents).toBe(1);
  });
});
