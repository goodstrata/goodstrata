import { type PublishInput, publishEvent } from "@goodstrata/events";
import { agentActor } from "@goodstrata/shared";
import { type Tool, tool } from "ai";
import type { z } from "zod";
import type { AgentRunCtx } from "./types.js";

/**
 * Publish an event on behalf of an agent run: actor, causation chain, and an
 * idempotency dedupe key are stamped automatically so pg-boss retries can
 * replay a half-finished run without double-effects.
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
  /** Mutating tools MUST publish at least one event — enforced below. */
  mutates: boolean;
  execute(input: z.infer<Schema>, ctx: AgentRunCtx): Promise<unknown>;
}

/**
 * Wrap a tool so the runtime's invariants hold:
 * - mutating tools must record what they did on the event log;
 * - tool errors are returned to the model as structured failures (the run
 *   continues; the model can adapt or give up).
 */
export function defineAgentTool<Schema extends z.ZodType>(
  ctx: AgentRunCtx,
  spec: AgentToolSpec<Schema>,
): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: z.infer<Schema>) => {
      const before = ctx.eventsPublished;
      try {
        const result = await spec.execute(input, ctx);
        if (spec.mutates && ctx.eventsPublished === before) {
          throw new Error("invariant: mutating agent tool completed without publishing an event");
        }
        return result ?? { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
