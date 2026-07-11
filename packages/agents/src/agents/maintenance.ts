import { maintenanceService, tradeRfqService } from "@goodstrata/core";
import { maintenanceRequests, rfqs, schemes } from "@goodstrata/db";
import { formatCents } from "@goodstrata/shared";
import type { ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

interface RequestPayload {
  requestId: string;
  title: string;
  description: string;
  lotId: string | null;
  /** Human origin: the reporter flagged the request an emergency at intake. */
  reportedEmergency?: boolean;
}

interface RfqCreatedPayload {
  rfqId: string;
  requestId: string;
  title: string;
  category: string;
}

/**
 * The maintenance agent triages new requests and proposes work orders. It
 * classifies and chooses a contractor; CODE routes the work order, and no
 * LLM-originated value (triage urgency, cost estimate) ever gates a dispatch:
 * an agent proposal always opens the committee decision gate unless the HUMAN
 * reporter flagged the request an emergency at intake (immediate dispatch +
 * post-hoc committee review).
 *
 * It is also the RFQ scope drafter: when an officer creates an RFQ, the agent
 * writes the anonymized scope-of-works DRAFT for human review. It never
 * dispatches an RFQ, never records or evaluates quotes, and never awards —
 * those tools do not exist on this agent, and it is not subscribed to any
 * quote event. Dispatch is the officer's button; the award runs only through
 * the decisions service (human committee approval).
 */
export const maintenanceAgent: AgentDefinition = {
  name: "maintenance",
  description:
    "Triages maintenance requests, proposes work orders, and drafts anonymized RFQ scopes of work",
  subscribedEvents: ["maintenance.request.created", "rfq.created"],
  systemPrompt: [
    "You are the maintenance agent for an Australian owners corporation.",
    "The user message states which of two tasks this run is.",
    "",
    "TASK A — a new maintenance request has arrived. Work through it:",
    "1. Call triageRequest exactly once: category (plumbing/electrical/roofing/cleaning/",
    "   structural/garden/other), urgency (emergency = active danger or major water/gas/power",
    "   failure; high = worsening damage; routine = everything else), and whether it concerns",
    "   COMMON property (roof, external walls, shared pipes, stairwells, gardens) or the",
    "   owner's own lot (internal fittings, own appliances).",
    "2. If it is NOT common property, call declineLotResponsibility with a kind explanation of",
    "   why it's the owner's responsibility, then finish.",
    "3. If it IS common property, call proposeWorkOrder with the best-matched contractor from",
    "   the provided list, a clear scope of work, and a realistic cost estimate in cents.",
    "   Routing is decided by the platform, never by you: your proposal ALWAYS goes to the",
    "   committee for approval before any contractor is engaged, unless the REPORTER flagged",
    "   the request as an emergency at intake — only that human flag dispatches immediately",
    "   (with a post-hoc committee review). Your urgency assessment and cost estimate never",
    "   trigger a dispatch on their own.",
    "Then finish with a one-line summary.",
    "",
    "TASK B — a request for quotes (RFQ) was created and needs its scope of works drafted.",
    "Call draftRfqSpec exactly once with a contractor-ready Markdown spec:",
    "- the trade category and a clear scope of works (what is wrong, what work is required,",
    "  likely materials), drawn from the maintenance request;",
    "- access constraints (common-area access, occupied areas, hours) and how many photos are",
    "  on file for the successful contractor;",
    "- compliance flags where relevant: working at heights, asbestos risk (older buildings),",
    "  licensed electrical/plumbing/gas work, confined spaces.",
    "The spec is sent to tradespeople OUTSIDE the platform before any award, so the location",
    "must stay at suburb level ONLY. NEVER include owner or resident names, email addresses,",
    "phone numbers, lot or unit numbers, the plan number, the scheme name, or the street",
    "address — the exact address is revealed to the winner after the committee awards.",
    "You draft the spec for human review only: you do not choose contractors, send the RFQ,",
    "assess quotes, or award work, and you have no tools to do so.",
    "Then finish with a one-line summary.",
  ].join("\n"),

  async buildContext(event, services) {
    if (!event.schemeId) return null;

    if (event.type === "rfq.created") {
      const payload = event.payload as RfqCreatedPayload;
      const rfq = await services.db.query.rfqs.findFirst({
        where: and(eq(rfqs.id, payload.rfqId), eq(rfqs.schemeId, event.schemeId)),
      });
      // The spec is only editable while the RFQ is a draft — skip otherwise.
      if (!rfq || rfq.status !== "draft") return null;
      const request = await services.db.query.maintenanceRequests.findFirst({
        where: and(
          eq(maintenanceRequests.id, rfq.requestId),
          eq(maintenanceRequests.schemeId, event.schemeId),
        ),
      });
      if (!request) return null;
      const photoCount = await maintenanceService.countRequestPhotos(
        services,
        event.schemeId,
        request.id,
      );

      return [
        "TASK B — draft the scope of works for this RFQ.",
        "",
        `RFQ title: ${rfq.title}`,
        `Trade category: ${rfq.category}`,
        `Location for the spec: ${rfq.suburb} (suburb only — nothing more precise)`,
        `Quotes due: ${rfq.quotesDueOn ?? "not set"}`,
        `Photos on file: ${photoCount}`,
        "",
        "Underlying maintenance request (INTERNAL — never copy identifying details into the spec):",
        `Title: ${request.title}`,
        `Description: ${request.description}`,
        `Urgency: ${request.urgency ?? "not assessed"}`,
        "",
        "Current placeholder spec (replace it with a proper scope of works):",
        rfq.specMd,
      ].join("\n");
    }

    const payload = event.payload as RequestPayload;
    const scheme = await services.db.query.schemes.findFirst({
      where: eq(schemes.id, event.schemeId),
    });
    if (!scheme) return null;
    const pool = await maintenanceService.listContractors(services, event.schemeId);
    const photoCount = await maintenanceService.countRequestPhotos(
      services,
      event.schemeId,
      payload.requestId,
    );

    return [
      "TASK A — triage this new maintenance request.",
      "",
      `Scheme: ${scheme.name}`,
      `Request title: ${payload.title}`,
      `Description: ${payload.description}`,
      `Photos on file: ${photoCount}`,
      `Reported for: ${payload.lotId ? "a specific lot" : "common property (unspecified)"}`,
      `Reporter flagged as emergency: ${payload.reportedEmergency ? "YES — a proposed work order dispatches immediately with post-hoc committee review" : "no — any work order you propose needs committee approval before dispatch"}`,
      "",
      `Committee auto-approve threshold for officer-raised work (context only — your own estimates always need approval): ${formatCents(scheme.settings.maintenanceAutoApproveCents)}`,
      "",
      "Approved contractors:",
      ...(pool.length > 0
        ? pool.map((c) => `- id=${c.id} ${c.businessName} [${c.tradeCategories.join(", ")}]`)
        : ["- (none registered — triage only; do not propose a work order)"]),
    ].join("\n");
  },

  tools(ctx): ToolSet {
    if (ctx.triggerEvent.type === "rfq.created") {
      const payload = ctx.triggerEvent.payload as RfqCreatedPayload;
      // The ONLY tool on an RFQ run. No dispatch, no quote, no award — the
      // draft lands on the RFQ for an officer to review and send.
      return {
        draftRfqSpec: defineAgentTool(ctx, {
          description:
            "Save the drafted anonymized scope of works onto the RFQ for officer review (the platform re-scrubs identifying details before storing)",
          inputSchema: tradeRfqService.applyRfqSpecInput,
          mutates: true,
          async execute(input) {
            if (!ctx.schemeId) throw new Error("no scheme");
            return await tradeRfqService.applyRfqSpec(
              ctx.services,
              ctx.schemeId,
              payload.rfqId,
              input,
            );
          },
        }),
      };
    }

    const payload = ctx.triggerEvent.payload as RequestPayload;

    return {
      triageRequest: defineAgentTool(ctx, {
        description: "Record the triage assessment for this request",
        inputSchema: z.object({
          category: z.string(),
          urgency: z.enum(["emergency", "high", "routine"]),
          isCommonProperty: z.boolean(),
          reasoning: z.string().max(1000),
        }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          return await maintenanceService.applyTriage(
            ctx.services,
            ctx.schemeId,
            payload.requestId,
            input,
          );
        },
      }),

      declineLotResponsibility: defineAgentTool(ctx, {
        description:
          "Close the request because it is the lot owner's responsibility, with a kind explanation emailed to the requester",
        inputSchema: z.object({ explanation: z.string().max(2000) }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          return await maintenanceService.declineAsLotResponsibility(
            ctx.services,
            ctx.schemeId,
            payload.requestId,
            input.explanation,
          );
        },
      }),

      proposeWorkOrder: defineAgentTool(ctx, {
        description:
          "Propose a work order: contractor, scope, estimated cost. Your proposal goes to the committee for approval before dispatch — unless the reporter flagged the request as an emergency at intake, in which case the platform dispatches immediately and opens a post-hoc committee review. Your estimate and urgency never trigger dispatch.",
        inputSchema: z.object({
          contractorId: z.string(),
          scope: z.string().min(5).max(5000),
          estimatedCents: z.number().int().positive(),
          accessNotes: z.string().max(1000).optional(),
        }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          const route = await maintenanceService.proposeWorkOrder(ctx.services, ctx.schemeId, {
            requestId: payload.requestId,
            ...input,
          });
          if (route.mode === "awaiting_approval") ctx.awaitingDecision = true;
          return route;
        },
      }),
    };
  },
  maxSteps: 6,
};
