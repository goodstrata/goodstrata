import type { Causation, ServiceContext } from "@goodstrata/core";
import { maintenanceService, tradeRfqService } from "@goodstrata/core";
import { people, rfqChannels, rfqs, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { loadEvent } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maintenanceAgent } from "../src/agents/maintenance.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { type ScriptStep, scriptedModel } from "../src/testing.js";
import type { AgentRunCtx } from "../src/types.js";

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

async function submitRequest(title: string, description: string, reportedEmergency = false) {
  const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
    title,
    description,
    reportedEmergency,
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
  it("an LLM estimate under the threshold NEVER auto-dispatches — committee gate opens", async () => {
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
              // Under the $500 auto-approve threshold — but it is the LLM's own
              // figure, so it must not gate a dispatch.
              estimatedCents: 15_000,
            },
          },
        ],
      },
      { text: "Triaged as routine plumbing; work order proposed for committee approval." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("awaiting_decision");

    const requests = await maintenanceService.listRequests(svc(), schemeId);
    const updated = requests.find((r) => r.id === request.id)!;
    expect(updated.status).toBe("quoting"); // awaiting the committee, not approved
    expect(updated.category).toBe("plumbing");

    // Nothing dispatched, nobody emailed, and the human gate is open.
    const orders = await maintenanceService.listWorkOrders(svc(), schemeId);
    expect(orders.every((o) => o.status !== "dispatched")).toBe(true);
    expect(memoryEmail.sent).toHaveLength(0);
    const decisions = await tdb.db.query.decisions.findMany({
      where: (t, { eq }) => eq(t.kind, "quote_approval"),
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.followUp).toMatchObject({ action: "maintenance.dispatchWorkOrder" });
  });

  it("a reporter-flagged emergency still dispatches immediately with post-hoc review", async () => {
    const { request, event } = await submitRequest(
      "Burst pipe flooding the basement carpark",
      "Water is pouring from a common riser — carpark flooding now.",
      true, // the HUMAN reporter flagged the emergency at intake
    );
    memoryEmail.sent.length = 0;

    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "triageRequest",
            input: {
              category: "plumbing",
              urgency: "emergency",
              isCommonProperty: true,
              reasoning: "Active flooding from a common riser.",
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
              scope: "Isolate the burst riser and repair; make safe the carpark",
              estimatedCents: 250_000,
            },
          },
        ],
      },
      { text: "Emergency dispatched with post-hoc committee review." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    const requests = await maintenanceService.listRequests(svc(), schemeId);
    expect(requests.find((r) => r.id === request.id)!.status).toBe("approved");

    // Dispatched immediately: contractor emailed, work order out the door…
    const orders = await maintenanceService.listWorkOrders(svc(), schemeId);
    expect(orders.some((o) => o.requestId === request.id && o.status === "dispatched")).toBe(true);
    expect(memoryEmail.sent.some((e) => e.to === "roof@example.com")).toBe(true);
    // …with the post-hoc committee review opened.
    const reviews = await tdb.db.query.decisions.findMany({
      where: (t, { eq }) => eq(t.kind, "emergency_review"),
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.followUp).toBeNull();
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

    // Newest gate is for this proposal (the under-threshold test opened one too).
    const decisions = await tdb.db.query.decisions.findMany({
      where: (t, { eq }) => eq(t.kind, "quote_approval"),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
    expect(decisions.length).toBeGreaterThan(0);
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

describe("maintenance agent — RFQ scope drafting", () => {
  async function createDraftRfq(title: string, description: string) {
    const request = await maintenanceService.createMaintenanceRequest(svc(), schemeId, {
      title,
      description,
    });
    await maintenanceService.applyTriage(svc(), schemeId, request.id, {
      category: "roofing",
      urgency: "high",
      isCommonProperty: true,
      reasoning: "test fixture",
    });
    const rfq = await tradeRfqService.createRfqFromRequest(svc(), schemeId, {
      requestId: request.id,
    });
    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "rfq.created"),
      orderBy: (t, { desc }) => desc(t.seq),
    });
    const event = (await loadEvent(tdb.db, events[0]!.id))!;
    return { request, rfq, event };
  }

  it("subscribes to rfq.created but to no quote or award event", () => {
    expect(maintenanceAgent.subscribedEvents).toEqual([
      "maintenance.request.created",
      "rfq.created",
    ]);
    expect(
      maintenanceAgent.subscribedEvents.some(
        (t) => t.startsWith("quote.") || t.includes("award") || t.includes("dispatch"),
      ),
    ).toBe(false);
  });

  it("exposes ONLY draftRfqSpec on an RFQ run — no dispatch, quote, or award tool", () => {
    const ctx = {
      triggerEvent: { type: "rfq.created", payload: { rfqId: "irrelevant" } },
    } as unknown as AgentRunCtx;
    expect(Object.keys(maintenanceAgent.tools(ctx))).toEqual(["draftRfqSpec"]);
  });

  it("drafts the spec into the RFQ (re-scrubbed) and leaves it a draft for humans", async () => {
    const { rfq, event } = await createDraftRfq(
      "Roof membrane failing over stairwell",
      "Water pooling in the top-floor stairwell after rain; membrane likely perished.",
    );

    // The scripted model writes PII into the spec on purpose — the platform
    // must scrub it before it lands on the RFQ.
    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "draftRfqSpec",
            input: {
              title: "Roof membrane repair — top-floor stairwell",
              category: "roofing",
              specMd: [
                "## Scope of works",
                "Strip and reseal the failed membrane above the top-floor stairwell",
                "at Agent Maint OC, 9 Drip Ln. Contact the reporter on 0412 345 678",
                "or reporter@example.com to arrange access.",
                "Working at heights compliance applies; 0 photos on file.",
                "Location: Fitzroy.",
              ].join("\n"),
            },
          },
        ],
      },
      { text: "Drafted the RFQ scope for officer review." },
    ]);

    const outcome = await runAgent(deps, maintenanceAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    const updated = (await tdb.db.query.rfqs.findFirst({
      where: (t, { eq }) => eq(t.id, rfq.id),
    }))!;
    // The draft landed…
    expect(updated.title).toBe("Roof membrane repair — top-floor stairwell");
    expect(updated.specMd).toContain("Strip and reseal the failed membrane");
    expect(updated.specMd).toContain("Working at heights");
    // …anonymized: scheme name, street address, phone, and email are gone,
    // suburb-level location remains.
    expect(updated.specMd).not.toContain("Agent Maint OC");
    expect(updated.specMd).not.toContain("9 Drip Ln");
    expect(updated.specMd).not.toContain("0412 345 678");
    expect(updated.specMd).not.toContain("reporter@example.com");
    expect(updated.specMd).toContain("Fitzroy");
    // The agent drafted — it did NOT dispatch: RFQ stays a human-reviewable
    // draft with zero channels.
    expect(updated.status).toBe("draft");
    const channels = await tdb.db.query.rfqChannels.findMany({
      where: eq(rfqChannels.rfqId, rfq.id),
    });
    expect(channels).toHaveLength(0);

    const drafted = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "rfq.spec_drafted"),
    });
    expect(drafted.some((e) => (e.payload as { rfqId: string }).rfqId === rfq.id)).toBe(true);
  });

  it("skips the run when the RFQ is no longer a draft", async () => {
    const { rfq, event } = await createDraftRfq(
      "Cracked balustrade panel",
      "Glass balustrade panel on level 2 walkway is cracked.",
    );
    await tdb.db.update(rfqs).set({ status: "published" }).where(eq(rfqs.id, rfq.id));

    const context = await maintenanceAgent.buildContext(event, svc());
    expect(context).toBeNull();

    const outcome = await runAgent(
      makeDeps([{ text: "should never generate" }]),
      maintenanceAgent,
      event,
    );
    expect(outcome).toEqual({ kind: "skipped", reason: "buildContext returned null" });
  });
});
