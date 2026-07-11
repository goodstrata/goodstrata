import { DomainError, ownershipsService } from "@goodstrata/core";
import { lots, memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemActor, systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { lotsRoutes } from "./onboarding.js";

/**
 * Route-level role permutations for the ownership register:
 *  - any member (owner / committee_member / officer) may read the register
 *  - only officers may add owners, end ownerships, or move the levy recipient
 *    (committee_member sees the register but holds no officer powers)
 *  - non-members get 404 (scheme existence never leaked)
 *  - zv validation failures surface as the 422 envelope; domain conflicts as 409
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;

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
  error: { code: string; message: string };
}

interface OwnershipEnvelope {
  ownership: { id: string; personId: string; isLevyRecipient: boolean; endedOn: string | null };
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

let lotCounter = 0;
async function newLot(): Promise<string> {
  lotCounter += 1;
  const rows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: `R${lotCounter}`, entitlement: 10, liability: 10 })
    .returning();
  return rows[0]!.id;
}

let personCounter = 0;
async function newPerson(): Promise<string> {
  personCounter += 1;
  const rows = await tdb.db
    .insert(people)
    .values({
      schemeId,
      givenName: `Roll${personCounter}`,
      email: `roll${personCounter}@example.com`,
    })
    .returning();
  return rows[0]!.id;
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
    .route("/schemes", lotsRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Ownership Route OC",
      planOfSubdivision: "PS888002R",
      addressLine1: "2 Route St",
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
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it("non-member gets 404 (not 403) on the ownership mutations", async () => {
    const lotId = await newLot();
    const personId = await newPerson();
    const res = await req(OUTSIDER, `/lots/${lotId}/owners`, { json: { personId } });
    expect(res.status).toBe(404);
    expect((await json<ErrorEnvelope>(res)).error.code).toBe("NOT_FOUND");
  });
});

describe("POST /lots/:lotId/owners", () => {
  it("officer adds an owner (201); the register read stays member-visible", async () => {
    const lotId = await newLot();
    const personId = await newPerson();
    const res = await req(CHAIR, `/lots/${lotId}/owners`, { json: { personId } });
    expect(res.status).toBe(201);
    const body = await json<OwnershipEnvelope>(res);
    expect(body.ownership).toMatchObject({ personId, isLevyRecipient: true, endedOn: null });

    // Any member reads the register, including the new ownership fields.
    const read = await req(OWNER, "/lots");
    expect(read.status).toBe(200);
    const { lots: register } = await json<{
      lots: { id: string; owners: { ownershipId: string; isLevyRecipient: boolean }[] }[];
    }>(read);
    const owners = register.find((l) => l.id === lotId)!.owners;
    expect(owners).toEqual([
      expect.objectContaining({ ownershipId: body.ownership.id, isLevyRecipient: true }),
    ]);
  });

  it.each([
    [COMMITTEE, "committee_member"],
    [OWNER, "owner"],
  ])("%s (%s) is refused with 403", async (userId) => {
    const lotId = await newLot();
    const personId = await newPerson();
    const res = await req(userId, `/lots/${lotId}/owners`, { json: { personId } });
    expect(res.status).toBe(403);
    expect((await json<ErrorEnvelope>(res)).error.code).toBe("FORBIDDEN");
  });

  it("rejects a malformed body with the 422 envelope", async () => {
    const lotId = await newLot();
    const res = await req(CHAIR, `/lots/${lotId}/owners`, { json: { personId: "not-a-uuid" } });
    expect(res.status).toBe(422);
    expect((await json<ErrorEnvelope>(res)).error.code).toBe("VALIDATION");
  });

  it("surfaces a duplicate current owner as 409", async () => {
    const lotId = await newLot();
    const personId = await newPerson();
    await req(CHAIR, `/lots/${lotId}/owners`, { json: { personId } });
    const res = await req(CHAIR, `/lots/${lotId}/owners`, { json: { personId } });
    expect(res.status).toBe(409);
    expect((await json<ErrorEnvelope>(res)).error.code).toBe("ALREADY_OWNER");
  });
});

describe("POST /lots/:lotId/owners/:ownershipId/end", () => {
  it("officer end-dates an ownership (200)", async () => {
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const res = await req(CHAIR, `/lots/${lotId}/owners/${ownership.id}/end`, { json: {} });
    expect(res.status).toBe(200);
    expect((await json<OwnershipEnvelope>(res)).ownership.endedOn).not.toBeNull();
  });

  it.each([
    [COMMITTEE, "committee_member"],
    [OWNER, "owner"],
  ])("%s (%s) is refused with 403", async (userId) => {
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const res = await req(userId, `/lots/${lotId}/owners/${ownership.id}/end`, { json: {} });
    expect(res.status).toBe(403);
  });

  it("non-member gets 404", async () => {
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const res = await req(OUTSIDER, `/lots/${lotId}/owners/${ownership.id}/end`, { json: {} });
    expect(res.status).toBe(404);
  });
});

describe("POST /lots/:lotId/owners/:ownershipId/levy-recipient", () => {
  it("officer moves the levy recipient (200)", async () => {
    const lotId = await newLot();
    await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const second = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const res = await req(CHAIR, `/lots/${lotId}/owners/${second.id}/levy-recipient`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await json<OwnershipEnvelope>(res)).ownership.isLevyRecipient).toBe(true);
  });

  it.each([
    [COMMITTEE, "committee_member"],
    [OWNER, "owner"],
  ])("%s (%s) is refused with 403", async (userId) => {
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const res = await req(userId, `/lots/${lotId}/owners/${ownership.id}/levy-recipient`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /lots/:lotId/owners/:ownershipId", () => {
  it("officer corrects kind/share (200); committee_member is refused (403)", async () => {
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(svc(), schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });

    const forbidden = await req(COMMITTEE, `/lots/${lotId}/owners/${ownership.id}`, {
      method: "PATCH",
      json: { kind: "joint" },
    });
    expect(forbidden.status).toBe(403);

    const res = await req(CHAIR, `/lots/${lotId}/owners/${ownership.id}`, {
      method: "PATCH",
      json: { kind: "joint" },
    });
    expect(res.status).toBe(200);
  });
});
