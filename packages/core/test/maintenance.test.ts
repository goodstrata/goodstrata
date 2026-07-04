import { schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as maintenanceService from "../src/services/maintenance.js";

let tdb: TestDatabase;
let schemeId: string;
let contractorId: string;
const managerUserId = "user-mgr-m";

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

async function newTriagedRequest(urgency: "emergency" | "high" | "routine") {
  const c = ctx();
  const request = await maintenanceService.createMaintenanceRequest(c, schemeId, {
    title: `Job ${Math.random().toString(36).slice(2, 8)}`,
    description: "Something needs fixing",
  });
  await maintenanceService.applyTriage(c, schemeId, request.id, {
    category: "plumbing",
    urgency,
    isCommonProperty: true,
    reasoning: "test",
  });
  return request;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Maint Test OC",
      planOfSubdivision: "PS999111M",
      addressLine1: "1 Fix St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(users).values({ id: managerUserId, name: "M", email: "m@x.com" });

  const contractor = await maintenanceService.createContractor(ctx(), schemeId, {
    businessName: "Fitzroy Plumbing Co",
    email: "jobs@fitzroyplumbing.example",
    tradeCategories: ["plumbing", "roofing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("work order threshold routing (code, not LLM)", () => {
  it("auto-dispatches under the auto-approve threshold and emails the contractor", async () => {
    const request = await newTriagedRequest("routine");
    memoryEmail.sent.length = 0;

    const route = await maintenanceService.proposeWorkOrder(ctx(), schemeId, {
      requestId: request.id,
      contractorId,
      scope: "Replace washer on common laundry tap",
      estimatedCents: 18_000, // $180 < $500 default threshold
    });

    expect(route.mode).toBe("auto_dispatched");
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("dispatched");
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("jobs@fitzroyplumbing.example");
    expect(memoryEmail.sent[0]!.text).toContain("$180.00");
  });

  it("routes over-threshold work to a committee decision; approval dispatches", async () => {
    const request = await newTriagedRequest("high");
    memoryEmail.sent.length = 0;

    const route = await maintenanceService.proposeWorkOrder(ctx(), schemeId, {
      requestId: request.id,
      contractorId,
      scope: "Reseal common roof membrane above lot 9",
      estimatedCents: 120_000, // $1,200 — between $500 and $2,000
    });

    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    // Nothing dispatched, no contractor email yet.
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("draft");
    expect(memoryEmail.sent).toHaveLength(0);

    // Committee approves → executor dispatches → contractor emailed.
    const c = ctx(userActor(managerUserId));
    await decisionsService.resolveDecision(c, schemeId, route.decisionId, "approve", ["chair"]);
    await decisionsService.executeDecisionFollowUp(ctx(), route.decisionId);

    const after = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(after.find((o) => o.id === route.workOrderId)!.status).toBe("dispatched");
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.text).toContain("Reseal common roof membrane");
  });

  it("flags multi-quote requirement above the higher threshold", async () => {
    const request = await newTriagedRequest("high");
    const route = await maintenanceService.proposeWorkOrder(ctx(), schemeId, {
      requestId: request.id,
      contractorId,
      scope: "Full repaint of external walls",
      estimatedCents: 850_000, // $8,500 > $2,000
    });
    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    const decisions = await decisionsService.listDecisions(ctx(), schemeId);
    const decision = decisions.find((d) => d.id === route.decisionId)!;
    expect(decision.summaryMd).toContain("comparison quotes");
  });

  it("emergency works dispatch immediately with a post-hoc review decision", async () => {
    const request = await newTriagedRequest("emergency");
    memoryEmail.sent.length = 0;

    const route = await maintenanceService.proposeWorkOrder(ctx(), schemeId, {
      requestId: request.id,
      contractorId,
      scope: "Burst common water main — shut off and repair",
      estimatedCents: 350_000, // way over both thresholds, but it's an emergency
    });

    expect(route.mode).toBe("emergency_dispatched");
    if (route.mode !== "emergency_dispatched") return;
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("dispatched");
    expect(memoryEmail.sent).toHaveLength(1); // contractor got it immediately

    const decisions = await decisionsService.listDecisions(ctx(), schemeId, "pending");
    const review = decisions.find((d) => d.id === route.reviewDecisionId)!;
    expect(review.kind).toBe("emergency_review");
    // Post-hoc review has NO followUp — acknowledging shouldn't dispatch anything.
    expect(review.followUp).toBeNull();
  });

  it("completes a dispatched work order and closes the request", async () => {
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    const dispatched = orders.find((o) => o.status === "dispatched")!;
    await maintenanceService.completeWorkOrder(ctx(), schemeId, dispatched.id);
    const after = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(after.find((o) => o.id === dispatched.id)!.status).toBe("completed");
  });

  it("includes contractor name and request title on listed work orders", async () => {
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(order.contractorName).toBe("Fitzroy Plumbing Co");
      expect(order.requestTitle).toMatch(/^Job /);
    }
  });

  it("refuses a work order on an untriaged request", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Untriaged thing",
      description: "…",
    });
    await expect(
      maintenanceService.proposeWorkOrder(ctx(), schemeId, {
        requestId: request.id,
        contractorId,
        scope: "nope",
        estimatedCents: 100,
      }),
    ).rejects.toThrow(/triaged/);
  });

  it("rejects a request lodged against a lot outside the scheme", async () => {
    await expect(
      maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
        title: "Wrong lot",
        description: "lot belongs to another scheme",
        lotId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/Lot/);
  });
});

describe("declining as lot responsibility", () => {
  it("records the explanation and closes the request", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "Leaking kitchen mixer tap",
      description: "Drips inside my unit",
    });
    await maintenanceService.declineAsLotResponsibility(
      ctx(),
      schemeId,
      request.id,
      "Internal tapware within a lot is the owner's responsibility.",
    );
    const after = (await maintenanceService.listRequests(ctx(), schemeId)).find(
      (r) => r.id === request.id,
    )!;
    expect(after.status).toBe("rejected");
    expect((after.aiTriage as { declineExplanation?: string }).declineExplanation).toContain(
      "owner's responsibility",
    );
  });

  it("refuses to decline a request that is already resolved", async () => {
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    const completed = orders.find((o) => o.status === "completed" && o.requestId)!;
    await expect(
      maintenanceService.declineAsLotResponsibility(ctx(), schemeId, completed.requestId!, "nope"),
    ).rejects.toThrow(/Cannot decline/);
  });
});
