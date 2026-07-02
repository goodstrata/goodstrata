import { type PublishInput, publishEvent } from "@goodstrata/events";
import { agentActor } from "@goodstrata/shared";
import { type Tool, tool } from "ai";
import type { z } from "zod";
import type { AgentRunCtx } from "./types.js";

/**
 * Publish an event directly on behalf of an agent run (for tools that don't
 * go through a service). Actor, causal linkage, and an idempotency dedupe key
 * are stamped automatically so pg-boss retries can't double-publish.
 *
 * Most tools should instead call `@goodstrata/core` services — those publish
 * their own events inside their transactions, and the runtime's ServiceContext
 * already carries the agent actor + causation.
 */
export async function agentPublish(
  ctx: AgentRunCtx,
  input: Omit<
    PublishInput,
    "actor" | "correlationId" | "causationId" | "causationDepth" | "dedupeKey"
  >,
) {
  ctx.toolCallSeq += 1;
  const result = await publishEvent(ctx.services.db, {
    ...input,
    actor: agentActor(ctx.agent, ctx.runId),
    correlationId: ctx.triggerEvent.correlationId,
    causationId: ctx.triggerEvent.id,
    causationDepth: ctx.triggerEvent.causationDepth + 1,
    dedupeKey: `${ctx.runId}:${ctx.toolCallSeq}`,
  });
  ctx.eventsPublished += 1;
  return result;
}

export interface AgentToolSpec<Schema extends z.ZodType> {
  description: string;
  inputSchema: Schema;
  /**
   * Documentation flag: mutating tools must record what they did on the event
   * log — either via a core service (which publishes in-transaction) or via
   * agentPublish.
   */
  mutates: boolean;
  execute(input: z.infer<Schema>, ctx: AgentRunCtx): Promise<unknown>;
}

/**
 * Wrap a tool so errors are returned to the model as structured failures —
 * the run continues and the model can adapt or give up gracefully.
 */
export function defineAgentTool<Schema extends z.ZodType>(
  ctx: AgentRunCtx,
  spec: AgentToolSpec<Schema>,
): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: z.infer<Schema>) => {
      try {
        const result = await spec.execute(input, ctx);
        return result ?? { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
