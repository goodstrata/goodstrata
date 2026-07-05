import { DomainError, maintenanceService, tradeRfqService } from "@goodstrata/core";
import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemActor, systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { rfqsRoutes } from "./rfqs.js";

/**
 * Route-level permutations for the RFQ family:
 *  - any member may read RFQs (fee disclosures included in the payload)
 *  - only officers may open, dispatch, record quotes on, or nominate awards
 *  - non-members get 404 (scheme existence never leaked)
 *  - FEE_UNDISCLOSED surfaces as 422 (zero hidden margin at the API edge)
 *  - /award only OPENS a decision — the RFQ is not awarded by the route
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;
let contractorId: string;

const CHAIR = "rfq-user-chair";
const COMMITTEE = "rfq-user-committee";
const OWNER = "rfq-user-owner";
const OUTSIDER = "rfq-user-outsider";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
  TRADE_MARKET_PROVIDERS: "scheme_book,email_rfq",
});

/** Typed body reader — Response.json() is `unknown` under this tsconfig. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

function req(userId: string, path: string, init?: { method?: string; json?: unknown }) {
  return app.request(`/schemes/${schemeId}${path}`, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: {
      "x-test-user": userId,
      ...(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}

const svc = () => deps.serviceContext(systemActor("test"));

async function triagedRequest() {
  const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
    title: `RFQ route job ${Math.random().toString(36).slice(2, 8)}`,
    description: "Common-property repair needing competitive quotes",
  });
  await maintenanceService.applyTriage(svc(), schemeId, request.id, {
    category: "plumbing",
    urgency: "routine",
    isCommonProperty: true,
    reasoning: "test",
  });
  return request;
}

/** Create + dispatch an RFQ through the routes so quotes can be recorded. */
async function dispatchedRfq() {
  const request = await triagedRequest();
  const created = await req(CHAIR, `/requests/${request.id}/rfq`, { json: {} });
  expect(created.status).toBe(201);
  const { rfq } = await json<{ rfq: { id: string } }>(created);
  const dispatched = await req(CHAIR, `/rfqs/${rfq.id}/dispatch`, {
    json: { contractorIds: [contractorId] },
  });
  expect(dispatched.status).toBe(200);
  return rfq;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  // Fake session: identity from a header, then the REAL scheme-membership and
  // role middleware run against the real database (same as app.ts wiring).
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", rfqsRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "RFQ Route Test OC",
      planOfSubdivision: "PS888002R",
      addressLine1: "2 Route St",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, COMMITTEE, OWNER, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: COMMITTEE, role: "committee_member", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
  ]);

  const contractor = await maintenanceService.createContractor(svc(), schemeId, {
    businessName: "RFQ Route Plumbing Co",
    email: "jobs@rfqrouteplumbing.example",
    tradeCategories: ["plumbing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it("non-member gets 404 (not 403) on GET /rfqs", async () => {
    const res = await req(OUTSIDER, "/rfqs");
    expect(res.status).toBe(404);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("opening an RFQ (officer only)", () => {
  it("owner and committee_member are refused (403 FORBIDDEN)", async () => {
    const request = await triagedRequest();
    for (const userId of [OWNER, COMMITTEE]) {
      const res = await req(userId, `/requests/${request.id}/rfq`, { json: {} });
      expect(res.status).toBe(403);
      const body = await json<ErrorEnvelope>(res);
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("chair opens an RFQ on a triaged request; suburb snapshotted, draft status", async () => {
    const request = await triagedRequest();
    const res = await req(CHAIR, `/requests/${request.id}/rfq`, { json: {} });
    expect(res.status).toBe(201);
    const { rfq } = await json<{
      rfq: { id: string; status: string; suburb: string; specMd: string };
    }>(res);
    expect(rfq.status).toBe("draft");
    expect(rfq.suburb).toBe("Brunswick");
    expect(rfq.specMd).toContain("Scope of works");
  });

  it("409 NOT_TRIAGED for an open (untriaged) request", async () => {
    const open = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
      title: "Untriaged for RFQ",
      description: "No triage yet",
    });
    const res = await req(CHAIR, `/requests/${open.id}/rfq`, { json: {} });
    expect(res.status).toBe(409);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NOT_TRIAGED");
  });

  it("every member can list RFQs; outsider POST is 404", async () => {
    for (const userId of [OWNER, COMMITTEE, CHAIR]) {
      const res = await req(userId, "/rfqs");
      expect(res.status).toBe(200);
      const { rfqs: list } = await json<{ rfqs: { id: string }[] }>(res);
      expect(list.length).toBeGreaterThan(0);
    }
    const request = await triagedRequest();
    const res = await req(OUTSIDER, `/requests/${request.id}/rfq`, { json: {} });
    expect(res.status).toBe(404);
  });
});

describe("spec editing (officer only; re-scrubbed)", () => {
  it("owner cannot edit; chair's edit is scrubbed of the scheme's own identifiers", async () => {
    const request = await triagedRequest();
    const created = await req(CHAIR, `/requests/${request.id}/rfq`, { json: {} });
    const { rfq } = await json<{ rfq: { id: string } }>(created);

    const spec = {
      title: "Replace burst riser",
      specMd:
        "## Scope of works\n\nBurst riser at 2 Route St (RFQ Route Test OC). Call 0412 345 678.",
      category: "plumbing",
    };
    const denied = await req(OWNER, `/rfqs/${rfq.id}/spec`, { json: spec });
    expect(denied.status).toBe(403);

    const res = await req(CHAIR, `/rfqs/${rfq.id}/spec`, { json: spec });
    expect(res.status).toBe(200);
    const { rfq: updated } = await json<{ rfq: { specMd: string } }>(res);
    // ANONYMIZED EXTERNAL POSTING: address, scheme name and phone are gone
    // even when an officer types them into the spec by hand.
    expect(updated.specMd).not.toContain("2 Route St");
    expect(updated.specMd).not.toContain("RFQ Route Test OC");
    expect(updated.specMd).not.toContain("0412 345 678");
    expect(updated.specMd).toContain("Burst riser");
  });

  it("409 BAD_STATUS once the RFQ has been dispatched", async () => {
    const rfq = await dispatchedRfq();
    const res = await req(CHAIR, `/rfqs/${rfq.id}/spec`, {
      json: { title: "Too late", specMd: "This RFQ has already gone out.", category: "plumbing" },
    });
    expect(res.status).toBe(409);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("BAD_STATUS");
  });
});

describe("dispatch (officer only)", () => {
  it("owner cannot dispatch; chair dispatch fans out to the contractor", async () => {
    const request = await triagedRequest();
    const created = await req(CHAIR, `/requests/${request.id}/rfq`, { json: {} });
    const { rfq } = await json<{ rfq: { id: string } }>(created);

    const denied = await req(OWNER, `/rfqs/${rfq.id}/dispatch`, {
      json: { contractorIds: [contractorId] },
    });
    expect(denied.status).toBe(403);

    const res = await req(CHAIR, `/rfqs/${rfq.id}/dispatch`, {
      json: { contractorIds: [contractorId] },
    });
    expect(res.status).toBe(200);
    const { result } = await json<{ result: { channelsSent: number } }>(res);
    expect(result.channelsSent).toBe(1);

    const detail = await req(OWNER, `/rfqs/${rfq.id}`);
    const body = await json<{ rfq: { status: string }; channels: { status: string }[] }>(detail);
    expect(body.rfq.status).toBe("published");
    expect(body.channels[0]!.status).toBe("sent");
  });

  it("422 NO_CHANNELS when dispatching to nobody", async () => {
    const request = await triagedRequest();
    const created = await req(CHAIR, `/requests/${request.id}/rfq`, { json: {} });
    const { rfq } = await json<{ rfq: { id: string } }>(created);
    const res = await req(CHAIR, `/rfqs/${rfq.id}/dispatch`, { json: {} });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NO_CHANNELS");
  });
});

describe("recording quotes (officer only; zero hidden margin)", () => {
  it("owner cannot record; chair records a scheme-book quote", async () => {
    const rfq = await dispatchedRfq();
    const denied = await req(OWNER, `/rfqs/${rfq.id}/quotes`, {
      json: { contractorId, amountCents: 100_000 },
    });
    expect(denied.status).toBe(403);

    const res = await req(CHAIR, `/rfqs/${rfq.id}/quotes`, {
      json: { contractorId, amountCents: 100_000 },
    });
    expect(res.status).toBe(201);
    const { quote } = await json<{ quote: { status: string; amountCents: number } }>(res);
    expect(quote.status).toBe("received");
    expect(quote.amountCents).toBe(100_000);
  });

  it("422 FEE_UNDISCLOSED for a nonzero fee without a named recipient", async () => {
    const rfq = await dispatchedRfq();
    const res = await req(CHAIR, `/rfqs/${rfq.id}/quotes`, {
      json: { contractorId, amountCents: 100_000, referralFeeCents: 1_500 },
    });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("FEE_UNDISCLOSED");
  });

  it("disclosed fees round-trip and render in the detail payload for every member", async () => {
    const rfq = await dispatchedRfq();
    const res = await req(CHAIR, `/rfqs/${rfq.id}/quotes`, {
      json: {
        contact: { businessName: "Kickback Plumbing", email: "quotes@kickback.example" },
        amountCents: 90_000,
        platformFeeCents: 2_500,
        referralFeeCents: 1_500,
        feeRecipient: "TradeMarket Pty Ltd",
      },
    });
    expect(res.status).toBe(201);

    // Fee disclosure reaches every member's read — not just officers.
    const detail = await req(OWNER, `/rfqs/${rfq.id}`);
    expect(detail.status).toBe(200);
    const body = await json<{
      quotes: {
        platformFeeCents: number;
        referralFeeCents: number;
        feeRecipient: string | null;
        feeDisclosure: string;
      }[];
    }>(detail);
    const quote = body.quotes.find((q) => q.platformFeeCents > 0)!;
    expect(quote.referralFeeCents).toBe(1_500);
    expect(quote.feeRecipient).toBe("TradeMarket Pty Ltd");
    expect(quote.feeDisclosure).toContain("TradeMarket Pty Ltd");
  });

  it("422 for fractional cents (unrounded client math)", async () => {
    const rfq = await dispatchedRfq();
    const res = await req(CHAIR, `/rfqs/${rfq.id}/quotes`, {
      json: { contractorId, amountCents: 449.995 * 100 },
    });
    expect(res.status).toBe(422);
  });
});

describe("award nomination (officer only; opens a decision, never awards)", () => {
  it("chair nominates → decisionId returned; RFQ is NOT awarded by the route", async () => {
    const rfq = await dispatchedRfq();
    const quoted = await req(CHAIR, `/rfqs/${rfq.id}/quotes`, {
      json: { contractorId, amountCents: 120_000 },
    });
    const { quote } = await json<{ quote: { id: string } }>(quoted);

    const denied = await req(OWNER, `/rfqs/${rfq.id}/award`, {
      json: { quoteId: quote.id },
    });
    expect(denied.status).toBe(403);

    const res = await req(CHAIR, `/rfqs/${rfq.id}/award`, { json: { quoteId: quote.id } });
    expect(res.status).toBe(201);
    const { result } = await json<{ result: { decisionId: string } }>(res);
    expect(result.decisionId).toBeTruthy();

    // AI NEVER PICKS / no auto-award: the route only opened the decision.
    const { rfq: after } = await tradeRfqService.getRfq(svc(), schemeId, rfq.id);
    expect(after.status).not.toBe("awarded");
    expect(after.awardedQuoteId).toBeNull();
    expect(after.decisionId).toBe(result.decisionId);
  });

  it("422 VALIDATION for a missing quoteId", async () => {
    const rfq = await dispatchedRfq();
    const res = await req(CHAIR, `/rfqs/${rfq.id}/award`, { json: {} });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("VALIDATION");
  });
});
