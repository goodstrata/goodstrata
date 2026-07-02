import type { Causation, ServiceContext } from "@goodstrata/core";
import { maintenanceService } from "@goodstrata/core";
import { people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { loadEvent } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maintenanceAgent } from "../src/agents/maintenance.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { type ScriptStep, scriptedModel } from "../src/testing.js";

let tdb: TestDatabase;
let schemeId: string;
let contractorId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

function makeDeps(script: ScriptStep[]): RuntimeDeps {
  const serviceContext = (actor: Actor, causation?: Causation): ServiceContext => ({
    db: tdb.db,
    clock: fixedClock("2026-07-02T00:00:00Z"),
    integrations,
    actor,
    causation,
  });
  return {
    resolveModel: createModelResolver({ AI_PROVIDER: "mock" }, () => scriptedModel(script)),
    serviceContext,
  };
}

function svc(): ServiceContext {
  return {
    db: tdb.db,
    clock: fixedClock("2026-07-02T00:00:00Z"),
    integrations,
    actor: systemActor("test"),
  };
}

async function submitRequest(title: string, description: string) {
  const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
    title,
    description,
  });
  // Load the created event the dispatcher would have delivered.
  const events = await tdb.db.query.eventLog.findMany({
    where: (t, { eq }) => eq(t.type, "maintenance.request.created"),
    orderBy: (t, { desc }) => desc(t.seq),
  });
  const event = await loadEvent(tdb.db, events[0]!.id);
  return { request, event: event! };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Agent Maint OC",
      planOfSubdivision: "PS999222N",
      addressLine1: "9 Drip Ln",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  const contractor = await maintenanceService.createContractor(svc(), schemeId, {
    businessName: "Rapid Roofing",
    email: "roof@example.com",
    tradeCategories: ["roofing", "plumbing"],
  });
  contractorId = contractor.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("maintenance agent", () => {
  it("triages and proposes; code auto-dispatches under the threshold", async () => {
    const { request, event } = await submitRequest(
      "Dripping tap in common laundry",
      "The cold tap won't fully close, slow drip for a week.",
    );
    memoryEmail.sent.length = 0;

    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "triageRequest",
            input: {
              category: "plumbing",
              urgency: "routine",
              isCommonProperty: true,
              reasoning: "Common laundry fixture, slow leak, no urgency.",
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            toolName: "proposeWorkOrder",
            input: {
              contractorId,
              scope: "Replace tap washer/cartridge in common laundry cold tap",
              estimatedCents: 15_000,
            },
          },
        ],
      },
      { text: "Triaged as routine plumbing and dispatched Rapid Roofing." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    const requests = await maintenanceService.listRequests(svc(), schemeId);
    const updated = requests.find((r) => r.id === request.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.category).toBe("plumbing");

    const orders = await maintenanceService.listWorkOrders(svc(), schemeId);
    expect(orders.some((o) => o.status === "dispatched")).toBe(true);
    expect(memoryEmail.sent.some((e) => e.to === "roof@example.com")).toBe(true);
  });

  it("over-threshold proposal ends the run awaiting the committee decision", async () => {
    const { event } = await submitRequest(
      "Water stain on lot 9 ceiling",
      "Brown stain growing after rain — likely roof membrane failure above.",
    );

    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "triageRequest",
            input: {
              category: "roofing",
              urgency: "high",
              isCommonProperty: true,
              reasoning: "Roof is common property; water ingress worsens.",
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            toolName: "proposeWorkOrder",
            input: {
              contractorId,
              scope: "Inspect and reseal roof membrane above lot 9",
              estimatedCents: 145_000,
            },
          },
        ],
      },
      { text: "Escalated to committee for approval." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("awaiting_decision");

    const decisions = await tdb.db.query.decisions.findMany({
      where: (t, { eq }) => eq(t.kind, "quote_approval"),
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.followUp).toMatchObject({ action: "maintenance.dispatchWorkOrder" });
  });

  it("declines lot-responsibility requests with an explanation email", async () => {
    // Requester person so the email has somewhere to go.
    const personRows = await tdb.db
      .insert(people)
      .values({ schemeId, givenName: "Renata", email: "renata@example.com" })
      .returning();
    const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
      title: "My dishwasher is broken",
      description: "Dishwasher in my kitchen stopped draining.",
      reportedByPersonId: personRows[0]!.id,
    });
    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "maintenance.request.created"),
      orderBy: (t, { desc }) => desc(t.seq),
    });
    const event = (await loadEvent(tdb.db, events[0]!.id))!;
    memoryEmail.sent.length = 0;

    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "declineLotResponsibility",
            input: {
              explanation:
                "Hi Renata — thanks for reporting this. A dishwasher inside your lot is the owner's responsibility rather than the owners corporation's, so we can't send a contractor for it. A local appliance repairer is your best bet. Sorry we can't help this time!",
            },
          },
        ],
      },
      { text: "Explained lot responsibility to the requester." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");

    const requests = await maintenanceService.listRequests(svc(), schemeId);
    expect(requests.find((r) => r.id === request.id)!.status).toBe("rejected");
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("renata@example.com");
  });
});
