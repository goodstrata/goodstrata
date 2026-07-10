import { announcementsService } from "@goodstrata/core";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

/**
 * The tracer-bullet agent: reacts to scheme.created and posts a real welcome
 * announcement through the announcements service (row + announcement.published
 * on the event log, in one transaction). Proves the full loop —
 * event → dispatcher → pg-boss → runtime → tool → service → new event.
 */
export const echoAgent: AgentDefinition = {
  name: "echo",
  description: "Tracer agent that acknowledges new schemes on the event bus",
  subscribedEvents: ["scheme.created"],
  systemPrompt: [
    "You are the GoodStrata echo agent. A new owners corporation scheme was",
    "just created. Call the postNote tool exactly once with a one-sentence",
    "friendly acknowledgement mentioning the scheme name, then finish.",
  ].join(" "),
  async buildContext(event) {
    return `Event ${event.type}: ${JSON.stringify(event.payload)}`;
  },
  tools(ctx) {
    return {
      postNote: defineAgentTool(ctx, {
        description: "Post a welcome announcement acknowledging the new scheme",
        inputSchema: z.object({ note: z.string().max(500) }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) {
            return { ok: false, error: "trigger event carries no scheme" };
          }
          const announcement = await announcementsService.createAnnouncement(
            ctx.services,
            ctx.schemeId,
            {
              title: "Welcome to GoodStrata",
              body: input.note,
              audience: "all",
              publish: true,
            },
          );
          return { ok: true, announcementId: announcement.id };
        },
      }),
    };
  },
  maxSteps: 3,
};
