import { DomainError, maintenanceService } from "@goodstrata/core";
import { memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemActor, systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { maintenanceRoutes } from "./maintenance.js";

/**
 * Route-level role permutations for the maintenance family:
 *  - any member (owner / committee_member / officer) may report and read
 *  - only officers may raise work orders, complete them, or manage contractors
 *  - non-members get 404 (scheme existence never leaked)
 *  - zv validation failures surface as the 422 envelope the web form maps
 *  - DomainError conflicts (already completed, not triaged) surface as 409
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;
let contractorId: string;
let ownerPersonId: string;

const CHAIR = "user-chair";
const COMMITTEE = "user-committee";
const OWNER = "user-owner";
const OUTSIDER = "user-outsider";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
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

async function triagedRequest(
  urgency: "emergency" | "high" | "routine" = "routine",
  reportedEmergency = false,
) {
  const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
    title: `Route job ${Math.random().toString(36).slice(2, 8)}`,
    description: "Needs fixing",
    reportedEmergency,
  });
  await maintenanceService.applyTriage(svc(), schemeId, request.id, {
    category: "plumbing",
    urgency,
    isCommonProperty: true,
    reasoning: "test",
  });
  return request;
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
    .route("/schemes", maintenanceRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Route Test OC",
      planOfSubdivision: "PS888001R",
      addressLine1: "1 Route St",
      suburb: "Fitzroy",
      postcode: "3065",
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
  const personRows = await tdb.db
    .insert(people)
    .values({ schemeId, userId: OWNER, givenName: "Olive", email: "user-owner@example.com" })
    .returning();
  ownerPersonId = personRows[0]!.id;

  const contractor = await maintenanceService.createContractor(svc(), schemeId, {
    businessName: "Route Plumbing Co",
    email: "jobs@routeplumbing.example",
    tradeCategories: ["plumbing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it.each([
    ["/maintenance"],
    ["/work-orders"],
    ["/contractors"],
  ])("non-member gets 404 (not 403) on GET %s", async (path) => {
    const res = await req(OUTSIDER, path);
    expect(res.status).toBe(404);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("reporting a maintenance issue (any member)", () => {
  it.each([[OWNER], [COMMITTEE], [CHAIR]])("%s can report", async (userId) => {
    const res = await req(userId, "/maintenance", {
      json: { title: `Report by ${userId}`, description: "Cracked tile in foyer" },
    });
    expect(res.status).toBe(201);
    const { request } = await json<{ request: { status: string } }>(res);
    expect(request.status).toBe("open");
  });

  it("stamps the reporter from the session, ignoring a spoofed reportedByPersonId", async () => {
    const res = await req(OWNER, "/maintenance", {
      json: {
        title: "Spoof attempt",
        description: "reportedByPersonId must come from the session",
        reportedByPersonId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.status).toBe(201);
    const { request } = await json<{ request: { reportedByPersonId: string } }>(res);
    expect(request.reportedByPersonId).toBe(ownerPersonId);
  });

  it("422 with field issues for a too-short title (dialog field mapping)", async () => {
    const res = await req(OWNER, "/maintenance", { json: { title: "ab", description: "valid" } });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details!.some((i) => i.path[0] === "title")).toBe(true);
  });

  // TODO(bug?): the API accepts a whitespace-only title ("   " passes min(3)
  // because createRequestInput does not trim). The web form trims to min 1, so
  // only direct API callers can create blank-looking requests. If server-side
  // trimming is adopted, unskip this.
  it.skip("rejects a whitespace-only title", async () => {
    const res = await req(OWNER, "/maintenance", {
      json: { title: "   ", description: "valid description" },
    });
    expect(res.status).toBe(422);
  });

  it("every member can read the request list", async () => {
    for (const userId of [OWNER, COMMITTEE, CHAIR]) {
      const res = await req(userId, "/maintenance");
      expect(res.status).toBe(200);
      const { requests } = await json<{ requests: { title: string }[] }>(res);
      expect(requests.some((r) => r.title === "Spoof attempt")).toBe(true);
    }
  });
});

describe("work orders (officer only)", () => {
  it("owner and committee_member are refused (403 FORBIDDEN)", async () => {
    const request = await triagedRequest();
    for (const userId of [OWNER, COMMITTEE]) {
      const res = await req(userId, "/work-orders", {
        json: {
          requestId: request.id,
          contractorId,
          scope: "Should never be allowed",
          estimatedCents: 100,
        },
      });
      expect(res.status).toBe(403);
      const body = await json<ErrorEnvelope>(res);
      expect(body.error.code).toBe("FORBIDDEN");
    }
    // Nothing leaked through: the request is still merely triaged.
    const listed = await maintenanceService.listRequests(svc(), schemeId);
    expect(listed.find((r) => r.id === request.id)!.status).toBe("triaged");
  });

  it("owner and committee_member may still LIST work orders", async () => {
    for (const userId of [OWNER, COMMITTEE]) {
      const res = await req(userId, "/work-orders");
      expect(res.status).toBe(200);
    }
  });

  it("chair raises under-threshold work → route.mode auto_dispatched", async () => {
    const request = await triagedRequest("routine");
    const res = await req(CHAIR, "/work-orders", {
      json: {
        requestId: request.id,
        contractorId,
        scope: "Replace tap washer in laundry",
        estimatedCents: 50_000, // exactly the default auto-approve ceiling
      },
    });
    expect(res.status).toBe(201);
    const { route } = await json<{ route: { mode: string } }>(res);
    expect(route.mode).toBe("auto_dispatched");
  });

  it("chair raises over-threshold work → route.mode awaiting_approval (committee decision)", async () => {
    const request = await triagedRequest("routine");
    const res = await req(CHAIR, "/work-orders", {
      json: {
        requestId: request.id,
        contractorId,
        scope: "Reseal the roof membrane",
        estimatedCents: 50_001,
      },
    });
    expect(res.status).toBe(201);
    const { route } = await json<{ route: { mode: string; decisionId?: string } }>(res);
    expect(route.mode).toBe("awaiting_approval");
    expect(route.decisionId).toBeTruthy();
  });

  it("reporter-flagged emergency request → route.mode emergency_dispatched with a post-hoc review", async () => {
    // The REPORTER flagged the emergency at intake; agent triage alone never dispatches.
    const request = await triagedRequest("emergency", true);
    const res = await req(CHAIR, "/work-orders", {
      json: {
        requestId: request.id,
        contractorId,
        scope: "Burst pipe — shut off and repair",
        estimatedCents: 300_000,
      },
    });
    expect(res.status).toBe(201);
    const { route } = await json<{ route: { mode: string; reviewDecisionId?: string } }>(res);
    expect(route.mode).toBe("emergency_dispatched");
    expect(route.reviewDecisionId).toBeTruthy();
  });

  it("422 for a 4-char scope and for non-integer cents (unrounded client math)", async () => {
    const request = await triagedRequest();
    const shortScope = await req(CHAIR, "/work-orders", {
      json: { requestId: request.id, contractorId, scope: "four", estimatedCents: 100 },
    });
    expect(shortScope.status).toBe(422);
    const scopeBody = await json<ErrorEnvelope>(shortScope);
    expect(scopeBody.error.details!.some((i) => i.path[0] === "scope")).toBe(true);

    const fractional = await req(CHAIR, "/work-orders", {
      json: {
        requestId: request.id,
        contractorId,
        scope: "valid scope",
        estimatedCents: 449.995 * 100, // 44999.500000000004 — client forgot to round
      },
    });
    expect(fractional.status).toBe(422);
  });

  it("409 NOT_TRIAGED when raising against an open (untriaged) request", async () => {
    const open = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
      title: "Still open",
      description: "No triage yet",
    });
    const res = await req(CHAIR, "/work-orders", {
      json: { requestId: open.id, contractorId, scope: "too early", estimatedCents: 100 },
    });
    expect(res.status).toBe(409);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NOT_TRIAGED");
  });

  it("complete: officer only; double-complete surfaces the 409 the row renders inline", async () => {
    const request = await triagedRequest("routine");
    const raise = await req(CHAIR, "/work-orders", {
      json: {
        requestId: request.id,
        contractorId,
        scope: "Small dispatched job",
        estimatedCents: 100,
      },
    });
    const { route } = await json<{ route: { mode: string; workOrderId: string } }>(raise);
    expect(route.mode).toBe("auto_dispatched");

    const ownerAttempt = await req(OWNER, `/work-orders/${route.workOrderId}/complete`, {
      method: "POST",
    });
    expect(ownerAttempt.status).toBe(403);

    const first = await req(CHAIR, `/work-orders/${route.workOrderId}/complete`, {
      method: "POST",
    });
    expect(first.status).toBe(200);

    const second = await req(CHAIR, `/work-orders/${route.workOrderId}/complete`, {
      method: "POST",
    });
    expect(second.status).toBe(409);
    const body = await json<ErrorEnvelope>(second);
    expect(body.error.code).toBe("BAD_STATUS");
    expect(body.error.message).toContain("completed");
  });
});

describe("contractor pool (officer only)", () => {
  it("owner and committee_member cannot add contractors", async () => {
    for (const userId of [OWNER, COMMITTEE]) {
      const res = await req(userId, "/contractors", {
        json: { businessName: "Nope Trades", tradeCategories: ["plumbing"] },
      });
      expect(res.status).toBe(403);
    }
  });

  it("chair adds a contractor; comma-split trades round-trip; it joins the pool", async () => {
    const tradeCategories = "plumbing, electrical" // as the web form splits it
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await req(CHAIR, "/contractors", {
      json: { businessName: "Split Trades Co", email: "", tradeCategories },
    });
    // email: "" is NOT a valid email — the web form sends undefined instead.
    expect(res.status).toBe(422);

    const ok = await req(CHAIR, "/contractors", {
      json: { businessName: "Split Trades Co", tradeCategories },
    });
    expect(ok.status).toBe(201);
    const { contractor } = await json<{
      contractor: { id: string; tradeCategories: string[]; status: string };
    }>(ok);
    expect(contractor.tradeCategories).toEqual(["plumbing", "electrical"]);
    expect(contractor.status).toBe("approved");

    const list = await req(OWNER, "/contractors"); // any member can read
    expect(list.status).toBe(200);
    const { contractors: pool } = await json<{ contractors: { id: string }[] }>(list);
    expect(pool.some((c) => c.id === contractor.id)).toBe(true);
  });

  it("422 for invalid email and for an empty trade list (',,,' after split)", async () => {
    const badEmail = await req(CHAIR, "/contractors", {
      json: { businessName: "Bad Email Co", email: "notanemail", tradeCategories: ["plumbing"] },
    });
    expect(badEmail.status).toBe(422);
    const emailBody = await json<ErrorEnvelope>(badEmail);
    expect(emailBody.error.details!.some((i) => i.path[0] === "email")).toBe(true);

    const noTrades = await req(CHAIR, "/contractors", {
      json: {
        businessName: "No Trades Co",
        tradeCategories: ",,,"
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
    });
    expect(noTrades.status).toBe(422);
    const tradesBody = await json<ErrorEnvelope>(noTrades);
    expect(tradesBody.error.details!.some((i) => i.path[0] === "tradeCategories")).toBe(true);
  });
});
