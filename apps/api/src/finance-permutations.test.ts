import { DomainError } from "@goodstrata/core";
import {
  budgetLines,
  budgets,
  funds,
  lots,
  memberships,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type MembershipRole, systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "./deps.js";
import { buildServiceContextFactory } from "./deps.js";
import type { AppEnv } from "./middleware.js";
import { financeRoutes } from "./routes/finance.js";

/**
 * Route-level permutation matrix for the finance family: WHO may hit each
 * mutation (requireSchemeMember + requireRole), and how the three failure
 * shapes come back over the wire —
 *   422 VALIDATION (zod envelope with per-field issues the web form maps),
 *   4xx DomainError (business rules: BUDGET_NOT_ADOPTED, ALREADY_ISSUED, …),
 *   403 FORBIDDEN / 404 non-member (scheme existence never leaks).
 * The service-level behaviour itself is covered in
 * packages/core/test/finance-permutations.test.ts and levy-loop.test.ts.
 */

let tdb: TestDatabase;
let app: Hono;
let schemeId: string;
let draftBudgetId: string;
let adoptedBudgetId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

/** userId per role under test. `outsider` has no membership at all. */
const USERS = {
  owner: "u-fin-owner",
  committee_member: "u-fin-cm",
  tenant: "u-fin-tenant",
  treasurer: "u-fin-treasurer",
  chair: "u-fin-chair",
  secretary: "u-fin-secretary",
  manager_admin: "u-fin-admin",
  outsider: "u-fin-outsider",
} as const;
type TestUser = keyof typeof USERS;

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: { path: (string | number)[]; message: string }[];
  };
}
/** Parse the error envelope of a failed response. */
async function errOf(res: Response): Promise<ErrorEnvelope["error"]> {
  return ((await res.json()) as ErrorEnvelope).error;
}

async function request(
  user: TestUser,
  method: "GET" | "POST",
  path: string,
  json?: unknown,
): Promise<Response> {
  return await app.request(`/schemes/${schemeId}${path}`, {
    method,
    headers: {
      "x-test-user": USERS[user],
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  // The real finance router behind a header-driven stand-in for requireAuth
  // (createApp applies requireAuth before mounting; session plumbing is
  // covered by auth.test.ts). requireSchemeMember/requireRole run for real.
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user");
      if (!id) {
        return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, 401);
      }
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", financeRoutes(deps))
    .onError((err, c) => {
      // Mirrors createApp's DomainError → envelope mapping.
      if (err instanceof DomainError) {
        return c.json(
          { error: { code: err.code, message: err.message, details: err.details } },
          // biome-ignore lint/suspicious/noExplicitAny: status validated by DomainError
          err.status as any,
        );
      }
      console.error("[finance-permutations] unhandled", err);
      return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
    }) as unknown as Hono; // collapse the RPC-schema type; tests only use .request()

  // ---- Fixture: an active scheme, two lots with owners, one draft + one adopted budget.
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Route Matrix OC",
      planOfSubdivision: "PS999001R",
      addressLine1: "9 Matrix St",
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

  for (const [role, id] of Object.entries(USERS)) {
    await tdb.db.insert(users).values({ id, name: id, email: `${id}@example.com` });
    if (role !== "outsider") {
      await tdb.db.insert(memberships).values({
        schemeId,
        userId: id,
        role: role as MembershipRole,
        startedOn: "2026-01-01",
      });
    }
  }

  for (const lotNumber of ["1", "2"]) {
    const lotRows = await tdb.db
      .insert(lots)
      .values({ schemeId, lotNumber, entitlement: 10, liability: 10 })
      .returning();
    const personRows = await tdb.db
      .insert(people)
      .values({
        schemeId,
        givenName: `Lot${lotNumber}`,
        familyName: "Owner",
        email: `lot${lotNumber}@example.com`,
      })
      .returning();
    await tdb.db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personRows[0]!.id,
      startedOn: "2020-01-01",
    });
  }

  // Budget factory rows: the adoption workflow itself is core-tested.
  const draft = (
    await tdb.db
      .insert(budgets)
      .values({ schemeId, fiscalYearStart: "2027-07-01", status: "committee_review" })
      .returning()
  )[0]!;
  draftBudgetId = draft.id;
  const adopted = (
    await tdb.db
      .insert(budgets)
      .values({ schemeId, fiscalYearStart: "2026-07-01", status: "adopted" })
      .returning()
  )[0]!;
  adoptedBudgetId = adopted.id;
  await tdb.db.insert(budgetLines).values([
    {
      budgetId: adoptedBudgetId,
      fundKind: "admin",
      category: "general",
      description: "Administration fund",
      amountCents: 240_000,
    },
    {
      budgetId: draftBudgetId,
      fundKind: "admin",
      category: "general",
      description: "Administration fund",
      amountCents: 100_000,
    },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("membership gate", () => {
  it("a non-member gets 404 (scheme existence never leaks), even on reads", async () => {
    const res = await request("outsider", "GET", "/budgets");
    expect(res.status).toBe(404);
    expect((await errOf(res)).code).toBe("NOT_FOUND");
  });

  it("plain members can read every finance surface", async () => {
    for (const path of [
      "/budgets",
      "/levy-schedules",
      "/levy-notices",
      "/payments",
      "/payments/status",
      "/arrears",
    ]) {
      const res = await request("owner", "GET", path);
      expect(res.status, `GET ${path} as owner`).toBe(200);
    }
  });
});

describe("officer gate on every finance mutation", () => {
  const NON_OFFICERS: TestUser[] = ["owner", "committee_member", "tenant"];
  const MUTATIONS: { name: string; path: string; json: unknown }[] = [
    {
      name: "POST /budgets",
      path: "/budgets",
      json: { fiscalYearStart: "2028-07-01", adminCents: 100, maintenanceCents: 0 },
    },
    {
      name: "POST /levy-schedules",
      path: "/levy-schedules",
      json: { budgetId: "irrelevant", frequency: "quarterly", firstDueOn: "2026-07-01" },
    },
    {
      name: "POST /levy-schedules/:id/issue",
      path: "/levy-schedules/some-id/issue",
      json: { instalment: 1 },
    },
    {
      name: "POST /payments/manual",
      path: "/payments/manual",
      json: { amountCents: 100, paidAt: "2026-07-01" },
    },
    {
      name: "POST /payments/:id/match",
      path: "/payments/some-id/match",
      json: { levyNoticeId: "some-notice" },
    },
  ];

  it("owner, committee_member and tenant are all 403 FORBIDDEN — before any validation runs", async () => {
    for (const user of NON_OFFICERS) {
      for (const m of MUTATIONS) {
        const res = await request(user, "POST", m.path, m.json);
        expect(res.status, `${m.name} as ${user}`).toBe(403);
        expect((await errOf(res)).code).toBe("FORBIDDEN");
      }
    }
  });

  it("treasurer, chair, secretary and manager_admin can all draft a budget (201)", async () => {
    for (const user of ["treasurer", "chair", "secretary", "manager_admin"] as TestUser[]) {
      const res = await request("owner", "GET", "/budgets");
      const before = ((await res.json()) as { budgets: unknown[] }).budgets.length;
      const created = await request(user, "POST", "/budgets", {
        fiscalYearStart: "2029-07-01",
        adminCents: 100,
        maintenanceCents: 0,
      });
      expect(created.status, `POST /budgets as ${user}`).toBe(201);
      const after = await request("owner", "GET", "/budgets");
      expect(((await after.json()) as { budgets: unknown[] }).budgets.length).toBe(before + 1);
    }
  });
});

describe("422 VALIDATION envelope: zod issues address the exact field the form rendered", () => {
  it("rejects a zero/negative/fractional admin amount with a path of ['adminCents']", async () => {
    for (const adminCents of [0, -500, 3333.5]) {
      const res = await request("treasurer", "POST", "/budgets", {
        fiscalYearStart: "2028-07-01",
        adminCents,
        maintenanceCents: 0,
      });
      expect(res.status, `adminCents=${adminCents}`).toBe(422);
      const error = await errOf(res);
      expect(error.code).toBe("VALIDATION");
      expect(error.details?.some((i) => i.path.includes("adminCents"))).toBe(true);
    }
  });

  it("rejects negative maintenance and a malformed fiscal year start", async () => {
    const neg = await request("treasurer", "POST", "/budgets", {
      fiscalYearStart: "2028-07-01",
      adminCents: 100,
      maintenanceCents: -1,
    });
    expect(neg.status).toBe(422);
    expect((await errOf(neg)).details?.some((i) => i.path.includes("maintenanceCents"))).toBe(true);

    const badDate = await request("treasurer", "POST", "/budgets", {
      fiscalYearStart: "01/07/2028",
      adminCents: 100,
      maintenanceCents: 0,
    });
    expect(badDate.status).toBe(422);
    expect((await errOf(badDate)).details?.some((i) => i.path.includes("fiscalYearStart"))).toBe(
      true,
    );
  });

  it("rejects out-of-range instalments (0 and 13) at the route boundary", async () => {
    for (const instalment of [0, 13]) {
      const res = await request("treasurer", "POST", "/levy-schedules/any-id/issue", {
        instalment,
      });
      expect(res.status, `instalment=${instalment}`).toBe(422);
      expect((await errOf(res)).code).toBe("VALIDATION");
    }
  });

  it("rejects manual payments with junk money or a non-ISO date", async () => {
    const cases: { json: Record<string, unknown>; field: string }[] = [
      { json: { amountCents: 0, paidAt: "2026-07-01" }, field: "amountCents" },
      { json: { amountCents: Number.NaN, paidAt: "2026-07-01" }, field: "amountCents" },
      { json: { amountCents: 100, paidAt: "01/07/2026" }, field: "paidAt" },
      { json: { amountCents: 100, paidAt: "2026-07-01", reference: "" }, field: "reference" },
    ];
    for (const { json, field } of cases) {
      const res = await request("treasurer", "POST", "/payments/manual", json);
      expect(res.status, JSON.stringify(json)).toBe(422);
      const error = await errOf(res);
      expect(error.code).toBe("VALIDATION");
      expect(
        error.details?.some((i) => i.path.includes(field)),
        `expected an issue on ${field}`,
      ).toBe(true);
    }
  });
});

describe("business errors surface as their DomainError envelope (never swallowed)", () => {
  let scheduleId: string;
  let noticeId: string;
  let matchedPaymentId: string;

  it("a schedule against the still-draft budget → 422 BUDGET_NOT_ADOPTED", async () => {
    const res = await request("treasurer", "POST", "/levy-schedules", {
      budgetId: draftBudgetId,
      frequency: "quarterly",
      firstDueOn: "2026-07-01",
    });
    expect(res.status).toBe(422);
    expect((await errOf(res)).code).toBe("BUDGET_NOT_ADOPTED");
  });

  it("the adopted budget schedules and issues; a duplicate issue → 409 ALREADY_ISSUED", async () => {
    const create = await request("treasurer", "POST", "/levy-schedules", {
      budgetId: adoptedBudgetId,
      frequency: "quarterly",
      firstDueOn: "2026-07-01",
    });
    expect(create.status).toBe(201);
    scheduleId = ((await create.json()) as { schedule: { id: string } }).schedule.id;

    const issue = await request("treasurer", "POST", `/levy-schedules/${scheduleId}/issue`, {
      instalment: 1,
    });
    expect(issue.status).toBe(201);
    expect(((await issue.json()) as { issued: number }).issued).toBe(2);

    const again = await request("treasurer", "POST", `/levy-schedules/${scheduleId}/issue`, {
      instalment: 1,
    });
    expect(again.status).toBe(409);
    const error = await errOf(again);
    expect(error.code).toBe("ALREADY_ISSUED");
    expect(error.message).toMatch(/already issued/i);
  });

  it("manual payment: duplicate bank reference → 200 with duplicate:true (idempotent, not an error)", async () => {
    const notices = await request("owner", "GET", "/levy-notices");
    noticeId = ((await notices.json()) as { notices: { id: string }[] }).notices[0]!.id;

    const json = {
      levyNoticeId: noticeId,
      amountCents: 1_000,
      paidAt: "2026-07-02",
      reference: "ROUTE-STMT-1",
    };
    const first = await request("treasurer", "POST", "/payments/manual", json);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { paymentId: string; matched: boolean };
    expect(firstBody.matched).toBe(true);
    matchedPaymentId = firstBody.paymentId;

    const dup = await request("treasurer", "POST", "/payments/manual", json);
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it("matching an already-matched payment → 409 PAYMENT_NOT_UNMATCHED", async () => {
    const res = await request("treasurer", "POST", `/payments/${matchedPaymentId}/match`, {
      levyNoticeId: noticeId,
    });
    expect(res.status).toBe(409);
    expect((await errOf(res)).code).toBe("PAYMENT_NOT_UNMATCHED");
  });

  it("payments/status now shows the scheme's own active collection account to every member", async () => {
    const res = await request("owner", "GET", "/payments/status");
    expect(res.status).toBe(200);
    const { status } = (await res.json()) as {
      status: { provider: string; trustAccount: { status: string; bsb: string | null } | null };
    };
    expect(status.provider).toBe("mock");
    expect(status.trustAccount?.status).toBe("active");
    expect(status.trustAccount?.bsb).toBeTruthy();
  });
});
