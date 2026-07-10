import { createModelResolver, defaultModelKey, type ModelResolver } from "@goodstrata/agents";
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

  // Mock-provider guard: `mock` is the DEFAULT provider, so a keyless prod
  // deploy would otherwise boot fine and have every agent silently "succeed"
  // doing nothing. Refuse to start unless explicitly allowed.
  if (defaultModelKey(aiEnv).startsWith("mock:")) {
    if (env.NODE_ENV === "production" && env.ALLOW_MOCK_AI !== "1") {
      throw new Error(
        "AI provider resolves to 'mock' in production — every agent would no-op silently. " +
          "Set AI_PROVIDER=anthropic (with ANTHROPIC_API_KEY) or AI_PROVIDER=local / AI_DEFAULT_MODEL, " +
          "or set ALLOW_MOCK_AI=1 to run keyless on purpose.",
      );
    }
    if (env.NODE_ENV === "development") {
      console.warn(
        "[ai] provider is 'mock' — agents return canned text and never call tools (set AI_PROVIDER=anthropic|local for real runs)",
      );
    }
  }

  if (env.AI_PROVIDER === "mock") {
    // Keyless dev/e2e: agents run against a static mock (no tool calls).
    const { staticTextModel } = await import("@goodstrata/agents/testing");
    return createModelResolver(aiEnv, () => staticTextModel("acknowledged (mock model)"));
  }
  return createModelResolver(aiEnv);
}

export { integrationsFromEnv };
