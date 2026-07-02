import { z } from "zod";
import { agentPublish, defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

/**
 * The tracer-bullet agent: reacts to scheme.created, writes a welcome note
 * onto the event log via a mutating tool. Proves the full loop —
 * event → dispatcher → pg-boss → runtime → tool → new event — end to end.
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
        description: "Post a note acknowledging the new scheme",
        inputSchema: z.object({ note: z.string().max(500) }),
        mutates: true,
        async execute(input) {
          await agentPublish(ctx, {
            schemeId: ctx.schemeId,
            stream: ctx.triggerEvent.stream,
            type: "announcement.published",
            payload: { title: "Welcome to GoodStrata", body: input.note, audience: "all" },
          });
          return { ok: true };
        },
      }),
    };
  },
  maxSteps: 3,
};
