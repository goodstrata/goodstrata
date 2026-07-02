import type { Database } from "@goodstrata/db";
import type { Integrations } from "@goodstrata/integrations";
import type { Actor, Clock } from "@goodstrata/shared";

/** Causal linkage inherited from the event that triggered the current work. */
export interface Causation {
  correlationId: string;
  causationId: string;
  causationDepth: number;
}

/**
 * Everything a service needs. Built once per API request (actor = user) or
 * per agent run (actor = agent); services never reach for globals.
 */
export interface ServiceContext {
  db: Database;
  clock: Clock;
  integrations: Integrations;
  actor: Actor;
  causation?: Causation;
}

/** Spread into publishEvent input to keep the causal chain linked. */
export function causationFields(ctx: ServiceContext) {
  if (!ctx.causation) return {};
  return {
    correlationId: ctx.causation.correlationId,
    causationId: ctx.causation.causationId,
    causationDepth: ctx.causation.causationDepth,
  };
}
