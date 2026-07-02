import { createModelResolver, type ModelResolver } from "@goodstrata/agents";
import type { Causation, ServiceContext } from "@goodstrata/core";
import type { Database } from "@goodstrata/db";
import { type Integrations, integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, type Clock, systemClock } from "@goodstrata/shared";
import type { Auth } from "./auth.js";
import type { Env } from "./env.js";

/** Process-wide dependencies, built once at boot and threaded everywhere. */
export interface AppDeps {
  env: Env;
  db: Database;
  auth: Auth;
  integrations: Integrations;
  clock: Clock;
  resolveModel: ModelResolver;
  serviceContext(actor: Actor, causation?: Causation): ServiceContext;
}

export function buildServiceContextFactory(
  db: Database,
  integrations: Integrations,
  clock: Clock = systemClock,
) {
  return (actor: Actor, causation?: Causation): ServiceContext => ({
    db,
    clock,
    integrations,
    actor,
    causation,
  });
}

export async function buildModelResolver(env: Env): Promise<ModelResolver> {
  // process.env is included so per-agent overrides (AI_MODEL_FINANCE=…) work.
  const aiEnv = {
    ...(process.env as Record<string, string | undefined>),
    AI_PROVIDER: env.AI_PROVIDER,
    AI_DEFAULT_MODEL: env.AI_DEFAULT_MODEL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
  };
  if (env.AI_PROVIDER === "mock") {
    // Keyless dev/e2e: agents run against a static mock (no tool calls).
    const { staticTextModel } = await import("@goodstrata/agents/testing");
    return createModelResolver(aiEnv, () => staticTextModel("acknowledged (mock model)"));
  }
  return createModelResolver(aiEnv);
}

export { integrationsFromEnv };
