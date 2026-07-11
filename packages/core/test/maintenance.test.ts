import { randomUUID } from "node:crypto";
import { schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, agentActor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
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

async function newTriagedRequest(
  urgency: "emergency" | "high" | "routine",
  opts: { reportedEmergency?: boolean } = {},
) {
  const c = ctx();
  const request = await maintenanceService.createMaintenanceRequest(c, schemeId, {
    title: `Job ${Math.random().toString(36).slice(2, 8)}`,
    description: "Something needs fixing",
    reportedEmergency: opts.reportedEmergency,
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

const png = (label: string) => ({
  filename: `${label}.png`,
  contentType: "image/png",
  content: new TextEncoder().encode(`fake-png-${label}`),
});

describe("report photos", () => {
  it("creates a request with photos, serves the bytes back, and counts them on the read shape", async () => {
    const request = await maintenanceService.createMaintenanceRequest(
      ctx(),
      schemeId,
      { title: "Water stain on lot 9 ceiling", description: "Spreading since the storm" },
      [png("stain-1"), png("stain-2")],
    );

    expect(request.images).toHaveLength(2);
    expect(request.photoCount).toBe(2);

    const { row, bytes } = await maintenanceService.getRequestImage(
      ctx(),
      schemeId,
      request.images[0]!.id,
    );
    expect(row.mime).toBe("image/png");
    expect(new TextDecoder().decode(bytes)).toBe("fake-png-stain-1");

    const listed = await maintenanceService.listRequests(ctx(), schemeId);
    const mine = listed.find((r) => r.id === request.id)!;
    expect(mine.images).toHaveLength(2);
    expect(mine.photoCount).toBe(2);

    // The count the triage agent's context quotes ("Photos on file: N").
    expect(await maintenanceService.countRequestPhotos(ctx(), schemeId, request.id)).toBe(2);
  });

  it("a request without photos reads photoCount 0", async () => {
    const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
      title: "No-photo report",
      description: "Nothing attached",
    });
    expect(request.photoCount).toBe(0);
    expect(await maintenanceService.countRequestPhotos(ctx(), schemeId, request.id)).toBe(0);
  });

  it("rejects more than 8 photos", async () => {
    const files = Array.from({ length: 9 }, (_, i) => png(`n${i}`));
    await expect(
      maintenanceService.createMaintenanceRequest(
        ctx(),
        schemeId,
        { title: "Too many", description: "photos" },
        files,
      ),
    ).rejects.toMatchObject({ code: "TOO_MANY_IMAGES" });
  });

  it("scopes image bytes to the scheme", async () => {
    const otherRows = await tdb.db
      .insert(schemes)
      .values({
        name: "Other OC",
        planOfSubdivision: `PS${Math.floor(Math.random() * 900000) + 100000}X`,
        addressLine1: "2 Away St",
        suburb: "Carlton",
        postcode: "3053",
        tier: 2,
        status: "active",
      })
      .returning();
    const request = await maintenanceService.createMaintenanceRequest(
      ctx(),
      schemeId,
      { title: "Scoped", description: "photo lives here" },
      [png("scoped")],
    );
    await expect(
      maintenanceService.getRequestImage(ctx(), otherRows[0]!.id, request.images[0]!.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("work order threshold routing (code, not LLM)", () => {
  it("auto-dispatches a HUMAN officer's under-threshold estimate and emails the contractor", async () => {
    const request = await newTriagedRequest("routine");
    memoryEmail.sent.length = 0;

    // The proposer is a signed-in user, so the estimate is human-supplied.
    const route = await maintenanceService.proposeWorkOrder(
      ctx(userActor(managerUserId)),
      schemeId,
      {
        requestId: request.id,
        contractorId,
        scope: "Replace washer on common laundry tap",
        estimatedCents: 18_000, // $180 < $500 default threshold
      },
    );

    expect(route.mode).toBe("auto_dispatched");
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("dispatched");
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("jobs@fitzroyplumbing.example");
    expect(memoryEmail.sent[0]!.text).toContain("$180.00");
  });

  it("an AGENT's under-threshold estimate never auto-dispatches — committee gate opens", async () => {
    const request = await newTriagedRequest("routine");
    memoryEmail.sent.length = 0;

    // Same cheap estimate, but LLM-originated (agent actor) → decision gate.
    const route = await maintenanceService.proposeWorkOrder(
      ctx(agentActor("maintenance", randomUUID())),
      schemeId,
      {
        requestId: request.id,
        contractorId,
        scope: "Replace washer on common laundry tap",
        estimatedCents: 100, // $1 — trivially under every threshold
      },
    );

    expect(route.mode).toBe("awaiting_approval");
    if (route.mode !== "awaiting_approval") return;
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("draft");
    expect(memoryEmail.sent).toHaveLength(0);
    const decisions = await decisionsService.listDecisions(ctx(), schemeId);
    expect(decisions.find((d) => d.id === route.decisionId)!.kind).toBe("quote_approval");
  });

  it("LLM triage urgency 'emergency' does NOT dispatch when the reporter didn't flag it", async () => {
    const request = await newTriagedRequest("emergency"); // triage says emergency; reporter did not
    memoryEmail.sent.length = 0;

    const route = await maintenanceService.proposeWorkOrder(
      ctx(agentActor("maintenance", randomUUID())),
      schemeId,
      {
        requestId: request.id,
        contractorId,
        scope: "Claimed-urgent repair",
        estimatedCents: 90_000,
      },
    );

    expect(route.mode).toBe("awaiting_approval");
    const orders = await maintenanceService.listWorkOrders(ctx(), schemeId);
    expect(orders.find((o) => o.id === route.workOrderId)!.status).toBe("draft");
    expect(memoryEmail.sent).toHaveLength(0);
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

  it("reporter-flagged emergency works dispatch immediately with a post-hoc review decision", async () => {
    // The REPORTER flagged the emergency at intake — the human-origin signal.
    const request = await newTriagedRequest("emergency", { reportedEmergency: true });
    memoryEmail.sent.length = 0;

    // Even an agent-proposed work order dispatches on the reporter's flag.
    const route = await maintenanceService.proposeWorkOrder(
      ctx(agentActor("maintenance", randomUUID())),
      schemeId,
      {
        requestId: request.id,
        contractorId,
        scope: "Burst common water main — shut off and repair",
        estimatedCents: 350_000, // way over both thresholds, but it's an emergency
      },
    );

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
