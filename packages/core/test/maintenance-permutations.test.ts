import { contractors, lots, people, schemes, users, workOrders } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as maintenanceService from "../src/services/maintenance.js";

/**
 * Permutation coverage for the maintenance family (requests, work orders,
 * contractors): input-validation boundaries, threshold routing at exact cents
 * boundaries, work-order status machine, and contractor pool filtering.
 * Complements maintenance.test.ts (happy paths per route mode).
 */

let tdb: TestDatabase;
let schemeId: string;
let otherSchemeId: string;
let lotId: string;
let otherSchemeLotId: string;
let contractorId: string;
let reporterPersonId: string;
const managerUserId = "user-mgr-perm";

// Default scheme settings (packages/db tenancy.ts): auto-approve $500,
// multi-quote $2,000. The routing boundaries below are relative to these.
const AUTO_APPROVE_CENTS = 50_000;
const MULTI_QUOTE_CENTS = 200_000;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

function ctx(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock("2026-07-02T00:00:00Z"), integrations, actor };
}

async function newTriagedRequest(
  urgency: "emergency" | "high" | "routine",
  overrides: Partial<maintenanceService.CreateRequestInput> = {},
) {
  const c = ctx();
  const request = await maintenanceService.createMaintenanceRequest(c, schemeId, {
    title: `Perm ${Math.random().toString(36).slice(2, 8)}`,
    description: "Something needs fixing",
    ...overrides,
  });
  await maintenanceService.applyTriage(c, schemeId, request.id, {
    category: "plumbing",
    urgency,
    isCommonProperty: true,
    reasoning: "test",
  });
  return request;
}

async function proposeFor(requestId: string, estimatedCents: number) {
  return await maintenanceService.proposeWorkOrder(ctx(), schemeId, {
    requestId,
    contractorId,
    scope: "Do the needful works on common property",
    estimatedCents,
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const schemeRows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Perm Test OC",
        planOfSubdivision: "PS777001P",
        addressLine1: "1 Matrix St",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 5,
        status: "active",
      },
      {
        name: "Other OC",
        planOfSubdivision: "PS777002P",
        addressLine1: "2 Elsewhere Rd",
        suburb: "Carlton",
        postcode: "3053",
        tier: 5,
        status: "active",
      },
    ])
    .returning();
  schemeId = schemeRows[0]!.id;
  otherSchemeId = schemeRows[1]!.id;

  const lotRows = await tdb.db
    .insert(lots)
    .values([
      { schemeId, lotNumber: "9", entitlement: 10, liability: 10 },
      { schemeId: otherSchemeId, lotNumber: "1", entitlement: 10, liability: 10 },
    ])
    .returning();
  lotId = lotRows[0]!.id;
  otherSchemeLotId = lotRows[1]!.id;

  await tdb.db.insert(users).values({ id: managerUserId, name: "M", email: "m-perm@x.com" });
  const personRows = await tdb.db
    .insert(people)
    .values({ schemeId, givenName: "Riley", familyName: "Reporter", email: "riley@example.com" })
    .returning();
  reporterPersonId = personRows[0]!.id;

  const contractor = await maintenanceService.createContractor(ctx(), schemeId, {
    businessName: "Boundary Plumbing Co",
    email: "jobs@boundaryplumbing.example",
    tradeCategories: ["plumbing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// Input validation boundaries (the zod schemas the API routes enforce via zv)
// ---------------------------------------------------------------------------

describe("createRequestInput validation", () => {
  it("rejects too-short title and description; accepts at the min boundary", () => {
    expect(
      maintenanceService.createRequestInput.safeParse({ title: "ab", description: "long enough" })
        .success,
    ).toBe(false);
    expect(
      maintenanceService.createRequestInput.safeParse({ title: "long enough", description: "ab" })
        .success,
    ).toBe(false);
    expect(
      maintenanceService.createRequestInput.safeParse({ title: "abc", description: "abc" })
        .success,
    ).toBe(true);
  });

  it("rejects an over-long title (max 200)", () => {
    expect(
      maintenanceService.createRequestInput.safeParse({
        title: "x".repeat(201),
        description: "desc",
      }).success,
    ).toBe(false);
  });
});

describe("proposeWorkOrderInput validation", () => {
  const base = { requestId: "r", contractorId: "c" };

  it("scope min-5 boundary: 4 chars fail, 5 pass", () => {
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "four",
        estimatedCents: 100,
      }).success,
    ).toBe(false);
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "5char",
        estimatedCents: 100,
      }).success,
    ).toBe(true);
  });

  it.each([0, -1, -100])("estimatedCents must be positive: %d rejected", (cents) => {
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "valid scope",
        estimatedCents: cents,
      }).success,
    ).toBe(false);
  });

  it("estimatedCents must be an integer — un-rounded client math (449.995 × 100) is rejected", () => {
    // The web client rounds ($449.995 → Math.round(44999.5) = 45000). The
    // schema is the server-side guard should a client ever skip the rounding.
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "valid scope",
        estimatedCents: 449.995 * 100, // 44999.500000000004
      }).success,
    ).toBe(false);
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "valid scope",
        estimatedCents: Math.round(449.995 * 100),
      }).success,
    ).toBe(true);
    expect(Math.round(449.995 * 100)).toBe(45_000); // deterministic money math
  });

  it("accessNotes max-1000 boundary: 1000 passes, 1001 fails; optional", () => {
    const withNotes = (n: number) =>
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "valid scope",
        estimatedCents: 100,
        accessNotes: "a".repeat(n),
      }).success;
    expect(withNotes(1000)).toBe(true);
    expect(withNotes(1001)).toBe(false);
    expect(
      maintenanceService.proposeWorkOrderInput.safeParse({
        ...base,
        scope: "valid scope",
        estimatedCents: 100,
      }).success,
    ).toBe(true);
  });
});

describe("createContractorInput validation", () => {
  it("businessName min-2 boundary", () => {
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "A",
        tradeCategories: ["plumbing"],
      }).success,
    ).toBe(false);
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "AB",
        tradeCategories: ["plumbing"],
      }).success,
    ).toBe(true);
  });

  it("email: omitted OK, invalid rejected", () => {
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "Valid Co",
        tradeCategories: ["plumbing"],
      }).success,
    ).toBe(true);
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "Valid Co",
        email: "notanemail",
        tradeCategories: ["plumbing"],
      }).success,
    ).toBe(false);
  });

  it("tradeCategories: empty list rejected — the web's ',,,' input splits to [] and fails here", () => {
    const fromCommaList = (raw: string) =>
      raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    expect(fromCommaList(",,,")).toEqual([]);
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "Valid Co",
        tradeCategories: fromCommaList(",,,"),
      }).success,
    ).toBe(false);
    // 'plumbing, electrical' → two trimmed categories.
    expect(fromCommaList("plumbing, electrical")).toEqual(["plumbing", "electrical"]);
    expect(
      maintenanceService.createContractorInput.safeParse({
        businessName: "Valid Co",
        tradeCategories: fromCommaList("plumbing, electrical"),
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Request lifecycle permutations
// ---------------------------------------------------------------------------

describe("request lifecycle", () => {
  it("common-property report stores lotId null; lot-specific report stores the lot", async () => {
    const common = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Common stairwell light out",
      description: "Level 2 landing",
    });
    expect(common.lotId).toBeNull();

    const lotSpecific = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Lot 9 balcony door jams",
      description: "Won't close",
      lotId,
    });
    expect(lotSpecific.lotId).toBe(lotId);
  });

  it("rejects a report against a lot that belongs to a different scheme", async () => {
    await expect(
      maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
        title: "Cross-scheme lot",
        description: "should not attach",
        lotId: otherSchemeLotId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applyTriage persists the agent fields the UI renders (category, urgency, common-property, reasoning)", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Sparking power point in foyer",
      description: "Visible sparks",
    });
    await maintenanceService.applyTriage(ctx(), schemeId, request.id, {
      category: "electrical",
      urgency: "emergency",
      isCommonProperty: true,
      reasoning: "Foyer is common property; sparking is a fire risk",
    });
    const after = (await maintenanceService.listRequests(ctx(), schemeId)).find(
      (r) => r.id === request.id,
    )!;
    expect(after.status).toBe("triaged");
    expect(after.category).toBe("electrical");
    expect(after.urgency).toBe("emergency");
    expect(after.isCommonProperty).toBe(true);
    expect((after.aiTriage as { reasoning?: string }).reasoning).toContain("fire risk");
  });

  it("re-triage of a triaged request → 409 ALREADY_TRIAGED", async () => {
    const request = await newTriagedRequest("routine");
    await expect(
      maintenanceService.applyTriage(ctx(), schemeId, request.id, {
        category: "plumbing",
        urgency: "routine",
        isCommonProperty: true,
        reasoning: "again",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_TRIAGED", status: 409 });
  });

  it("triage of a request from another scheme → NOT_FOUND (scheme scoping)", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Scoped request",
      description: "belongs to schemeId",
    });
    await expect(
      maintenanceService.applyTriage(ctx(), otherSchemeId, request.id, {
        category: "plumbing",
        urgency: "routine",
        isCommonProperty: true,
        reasoning: "wrong scheme",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("decline after triage keeps the triage record, adds declineExplanation, and emails the reporter", async () => {
    memoryEmail.sent.length = 0;
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Leaking ensuite tap",
      description: "Inside lot 9",
      lotId,
      reportedByPersonId: reporterPersonId,
    });
    await maintenanceService.applyTriage(ctx(), schemeId, request.id, {
      category: "plumbing",
      urgency: "routine",
      isCommonProperty: false,
      reasoning: "Internal tapware sits within the lot",
    });
    await maintenanceService.declineAsLotResponsibility(
      ctx(),
      schemeId,
      request.id,
      "Internal tapware is the lot owner's responsibility.",
    );

    const after = (await maintenanceService.listRequests(ctx(), schemeId)).find(
      (r) => r.id === request.id,
    )!;
    expect(after.status).toBe("rejected");
    const triage = after.aiTriage as { reasoning?: string; declineExplanation?: string };
    expect(triage.reasoning).toContain("within the lot"); // prior triage preserved
    expect(triage.declineExplanation).toContain("owner's responsibility");

    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("riley@example.com");
    expect(memoryEmail.sent[0]!.text).toContain("owner's responsibility");
  });

  it("decline of an already-rejected request → 409 BAD_STATUS", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Doubly declined",
      description: "decline twice",
    });
    await maintenanceService.declineAsLotResponsibility(ctx(), schemeId, request.id, "First.");
    await expect(
      maintenanceService.declineAsLotResponsibility(ctx(), schemeId, request.id, "Second."),
    ).rejects.toMatchObject({ code: "BAD_STATUS", status: 409 });
  });
});

// ---------------------------------------------------------------------------
// Threshold routing at exact boundaries (deterministic money paths)
// ---------------------------------------------------------------------------

describe("work order routing boundaries", () => {
  it(`exactly the auto-approve threshold (${AUTO_APPROVE_CENTS}c) auto-dispatches`, async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, AUTO_APPROVE_CENTS);
    expect(route.mode).toBe("auto_dispatched");
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    const wo = orders.find((o) => o.id === route.workOrderId)!;
    expect(wo.status).toBe("dispatched");
    expect(wo.approvedAmountCents).toBe(AUTO_APPROVE_CENTS);
  });

  it("one cent over the auto-approve threshold routes to committee approval", async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, AUTO_APPROVE_CENTS + 1);
    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("draft");
    // The request moves to quoting while the committee decides.
    const after = (await maintenanceService.listRequests(ctx(), schemeId)).find(
      (r) => r.id === request.id,
    )!;
    expect(after.status).toBe("quoting");
  });

  it("exactly the multi-quote threshold does NOT carry the comparison-quotes note", async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, MULTI_QUOTE_CENTS);
    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    const decision = (await decisionsService.listDecisions(ctx(), schemeId)).find(
      (d) => d.id === route.decisionId,
    )!;
    expect(decision.summaryMd).not.toContain("comparison quotes");
  });

  it("one cent over the multi-quote threshold carries the comparison-quotes note", async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, MULTI_QUOTE_CENTS + 1);
    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    const decision = (await decisionsService.listDecisions(ctx(), schemeId)).find(
      (d) => d.id === route.decisionId,
    )!;
    expect(decision.summaryMd).toContain("comparison quotes");
  });

  it("emergency urgency wins over the amount: even a tiny job takes the emergency path", async () => {
    const request = await newTriagedRequest("emergency");
    const route = await proposeFor(request.id, 100); // $1 — far below auto threshold
    expect(route.mode).toBe("emergency_dispatched");
    if (route.mode !== "emergency_dispatched") return;
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("dispatched");
    const review = (await decisionsService.listDecisions(ctx(), schemeId)).find(
      (d) => d.id === route.reviewDecisionId,
    )!;
    expect(review.kind).toBe("emergency_review");
  });

  it("high urgency does NOT get the emergency shortcut — thresholds still apply", async () => {
    const request = await newTriagedRequest("high");
    const route = await proposeFor(request.id, AUTO_APPROVE_CENTS + 1);
    expect(route.mode).toBe("awaiting_approval");
  });

  it("rejects a work order against an unknown contractor", async () => {
    const request = await newTriagedRequest("routine");
    await expect(
      maintenanceService.proposeWorkOrder(ctx(), schemeId, {
        requestId: request.id,
        contractorId: "00000000-0000-0000-0000-000000000000",
        scope: "valid scope here",
        estimatedCents: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a work order against a non-approved (pending) contractor", async () => {
    const pendingRows = await tdb.db
      .insert(contractors)
      .values({
        schemeId,
        businessName: "Pending Trades Pty Ltd",
        tradeCategories: ["electrical"],
        status: "pending",
      })
      .returning();
    const request = await newTriagedRequest("routine");
    await expect(
      maintenanceService.proposeWorkOrder(ctx(), schemeId, {
        requestId: request.id,
        contractorId: pendingRows[0]!.id,
        scope: "valid scope here",
        estimatedCents: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a work order for a request that belongs to another scheme", async () => {
    const request = await newTriagedRequest("routine");
    await expect(
      maintenanceService.proposeWorkOrder(ctx(), otherSchemeId, {
        requestId: request.id,
        contractorId,
        scope: "valid scope here",
        estimatedCents: 100,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Work order completion status machine
// ---------------------------------------------------------------------------

describe("completeWorkOrder status permutations", () => {
  async function dispatchedWorkOrder() {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, 100);
    expect(route.mode).toBe("auto_dispatched");
    return { workOrderId: route.workOrderId, requestId: request.id };
  }

  it.each(["dispatched", "accepted", "scheduled", "in_progress"] as const)(
    "completes from %s",
    async (status) => {
      const { workOrderId } = await dispatchedWorkOrder();
      if (status !== "dispatched") {
        await tdb.db.update(workOrders).set({ status }).where(eq(workOrders.id, workOrderId));
      }
      const result = await maintenanceService.completeWorkOrder(ctx(), schemeId, workOrderId);
      expect(result.workOrderId).toBe(workOrderId);
      const after = await maintenanceService.listWorkOrders(ctx(), schemeId);
      expect(after.find((o) => o.id === workOrderId)!.status).toBe("completed");
    },
  );

  it("completing closes the linked request too", async () => {
    const { workOrderId, requestId } = await dispatchedWorkOrder();
    await maintenanceService.completeWorkOrder(ctx(), schemeId, workOrderId);
    const request = (await maintenanceService.listRequests(ctx(), schemeId)).find(
      (r) => r.id === requestId,
    )!;
    expect(request.status).toBe("completed");
  });

  it("completing an already-completed work order → 409 BAD_STATUS (the UI's inline row error)", async () => {
    const { workOrderId } = await dispatchedWorkOrder();
    await maintenanceService.completeWorkOrder(ctx(), schemeId, workOrderId);
    await expect(
      maintenanceService.completeWorkOrder(ctx(), schemeId, workOrderId),
    ).rejects.toMatchObject({
      code: "BAD_STATUS",
      status: 409,
      message: expect.stringContaining("completed"),
    });
  });

  it("cannot complete a draft work order still awaiting committee approval", async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, AUTO_APPROVE_CENTS + 1);
    expect(route.mode).toBe("awaiting_approval");
    await expect(
      maintenanceService.completeWorkOrder(ctx(), schemeId, route.workOrderId),
    ).rejects.toMatchObject({ code: "BAD_STATUS", status: 409 });
  });

  it("cannot complete a work order through the wrong scheme", async () => {
    const { workOrderId } = await dispatchedWorkOrder();
    await expect(
      maintenanceService.completeWorkOrder(ctx(), otherSchemeId, workOrderId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("committee approval then follow-up execution dispatches; completion then closes it", async () => {
    const request = await newTriagedRequest("routine");
    const route = await proposeFor(request.id, AUTO_APPROVE_CENTS + 1);
    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;

    const officer = ctx(userActor(managerUserId));
    await decisionsService.resolveDecision(officer, schemeId, route.decisionId, "approve", [
      "chair",
    ]);
    await decisionsService.executeDecisionFollowUp(ctx(), route.decisionId);

    await maintenanceService.completeWorkOrder(ctx(), schemeId, route.workOrderId);
    const after = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(after.find((o) => o.id === route.workOrderId)!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Contractor pool
// ---------------------------------------------------------------------------

describe("contractor pool", () => {
  it("category filter is a case-insensitive substring over trade categories", async () => {
    const byPlumb = await maintenanceService.listContractors(ctx(), schemeId, "Plumb");
    expect(byPlumb.some((c) => c.businessName === "Boundary Plumbing Co")).toBe(true);
    const byWelding = await maintenanceService.listContractors(ctx(), schemeId, "welding");
    expect(byWelding.some((c) => c.businessName === "Boundary Plumbing Co")).toBe(false);
  });

  it("only approved contractors are listed (pending/suspended excluded)", async () => {
    await tdb.db.insert(contractors).values({
      schemeId,
      businessName: "Suspended Sparks",
      tradeCategories: ["electrical"],
      status: "suspended",
    });
    const pool = await maintenanceService.listContractors(ctx(), schemeId);
    expect(pool.every((c) => c.status === "approved")).toBe(true);
    expect(pool.some((c) => c.businessName === "Suspended Sparks")).toBe(false);
    expect(pool.some((c) => c.businessName === "Pending Trades Pty Ltd")).toBe(false);
  });

  it("createContractor lands in the pool immediately (approved) with its trades", async () => {
    const created = await maintenanceService.createContractor(ctx(), schemeId, {
      businessName: "Split Trades Co",
      tradeCategories: ["plumbing", "electrical"],
    });
    expect(created.status).toBe("approved");
    const pool = await maintenanceService.listContractors(ctx(), schemeId);
    const found = pool.find((c) => c.id === created.id)!;
    expect(found.tradeCategories).toEqual(["plumbing", "electrical"]);
  });

  it("contractor pool is scheme-scoped", async () => {
    const otherPool = await maintenanceService.listContractors(ctx(), otherSchemeId);
    expect(otherPool).toEqual([]);
  });
});
