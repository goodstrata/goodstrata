import { maintenanceService } from "@goodstrata/core";
import { schemes } from "@goodstrata/db";
import { formatCents } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

interface RequestPayload {
  requestId: string;
  title: string;
  description: string;
  lotId: string | null;
}

/**
 * The maintenance agent triages new requests and proposes work orders. It
 * classifies and chooses a contractor; CODE routes the work order by the
 * scheme's thresholds (auto / decision gate / emergency + post-hoc review).
 */
export const maintenanceAgent: AgentDefinition = {
  name: "maintenance",
  description: "Triages maintenance requests and proposes work orders",
  subscribedEvents: ["maintenance.request.created"],
  systemPrompt: [
    "You are the maintenance agent for an Australian owners corporation.",
    "A new maintenance request has arrived. Work through it:",
    "1. Call triageRequest exactly once: category (plumbing/electrical/roofing/cleaning/",
    "   structural/garden/other), urgency (emergency = active danger or major water/gas/power",
    "   failure; high = worsening damage; routine = everything else), and whether it concerns",
    "   COMMON property (roof, external walls, shared pipes, stairwells, gardens) or the",
    "   owner's own lot (internal fittings, own appliances).",
    "2. If it is NOT common property, call declineLotResponsibility with a kind explanation of",
    "   why it's the owner's responsibility, then finish.",
    "3. If it IS common property, call proposeWorkOrder with the best-matched contractor from",
    "   the provided list, a clear scope of work, and a realistic cost estimate in cents.",
    "   The platform decides whether it auto-dispatches or goes to the committee — not you.",
    "Then finish with a one-line summary.",
  ].join("\n"),

  async buildContext(event, services) {
    const payload = event.payload as RequestPayload;
    if (!event.schemeId) return null;
    const scheme = await services.db.query.schemes.findFirst({
      where: eq(schemes.id, event.schemeId),
    });
    if (!scheme) return null;
    const pool = await maintenanceService.listContractors(services, event.schemeId);

    return [
      `Scheme: ${scheme.name}`,
      `Request title: ${payload.title}`,
      `Description: ${payload.description}`,
      `Reported for: ${payload.lotId ? "a specific lot" : "common property (unspecified)"}`,
      "",
      `Auto-approve threshold: ${formatCents(scheme.settings.maintenanceAutoApproveCents)}`,
      "",
      "Approved contractors:",
      ...(pool.length > 0
        ? pool.map((c) => `- id=${c.id} ${c.businessName} [${c.tradeCategories.join(", ")}]`)
        : ["- (none registered — triage only; do not propose a work order)"]),
    ].join("\n");
  },

  tools(ctx) {
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
          "Propose a work order: contractor, scope, estimated cost. The platform routes it (auto-dispatch, committee approval, or emergency) by the scheme's thresholds.",
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
