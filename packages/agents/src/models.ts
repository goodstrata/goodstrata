import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface AiEnv {
  // anthropic | local | mock. Does NOT select the provider — routing comes
  // from the resolved key's 'provider:' prefix. Only consulted by
  // defaultKeyFor() to pick a fallback default key when neither a per-agent
  // override, an agent modelKey, nor AI_DEFAULT_MODEL is set.
  AI_PROVIDER?: string;
  AI_DEFAULT_MODEL?: string; // e.g. "anthropic:claude-sonnet-4-5" | "local:qwen3:14b"
  ANTHROPIC_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
  /** Per-agent overrides: AI_MODEL_FINANCE etc. */
  [key: string]: string | undefined;
}

export type ModelResolver = (
  agentName: string,
  modelKeyOverride?: string,
) => {
  model: LanguageModel;
  modelId: string;
};

/**
 * Env-driven model resolution. "provider:model" keys; per-agent env overrides
 * (AI_MODEL_<AGENT>) beat the agent definition, which beats AI_DEFAULT_MODEL.
 *
 * `mockModel` is injected by the caller (tests, dev without keys) so this
 * module never imports test utilities.
 */
export function createModelResolver(env: AiEnv, mockModel?: () => LanguageModel): ModelResolver {
  return (agentName, modelKeyOverride) => {
    // Treat a blank env override (AI_MODEL_FINANCE="") as unset rather than a
    // real override that would produce a misleading "unknown provider" error.
    const envOverride = env[`AI_MODEL_${agentName.toUpperCase()}`]?.trim() || undefined;
    const key = envOverride ?? modelKeyOverride ?? env.AI_DEFAULT_MODEL ?? defaultKeyFor(env);

    const [provider, ...rest] = key.split(":");
    const modelName = rest.join(":");

    if (!provider || !modelName) {
      throw new Error(
        `Invalid AI model key '${key}' for agent '${agentName}': expected 'provider:model'.`,
      );
    }

    switch (provider) {
      case "anthropic": {
        if (!env.ANTHROPIC_API_KEY) {
          // Reference the resolved key, not AI_PROVIDER — this branch can be
          // reached via a per-agent key (AI_MODEL_<AGENT>=anthropic:...) even
          // when AI_PROVIDER is something else.
          throw new Error(`Model key '${key}' requires ANTHROPIC_API_KEY`);
        }
        const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
        return { model: anthropic(modelName), modelId: key };
      }
      case "local": {
        // Any OpenAI-compatible endpoint: Ollama, vLLM, OpenRouter, Workers AI…
        const base = env.OPENAI_COMPAT_BASE_URL ?? env.OLLAMA_BASE_URL ?? "http://localhost:11434";
        const apiKey = env.OPENAI_COMPAT_API_KEY ?? env.OLLAMA_API_KEY;
        const local = createOpenAICompatible({
          name: "openai-compatible",
          baseURL: `${base.replace(/\/$/, "")}/v1`,
          // The vision/extraction path uses generateObject and needs the strict
          // json_schema response format to reliably conform. Agents stay in
          // prompt-JSON mode so weaker local models aren't forced into a
          // structured-output mode they may not support.
          ...(agentName === "vision" ? { supportsStructuredOutputs: true } : {}),
          ...(apiKey ? { apiKey } : {}),
        });
        return { model: local(modelName), modelId: key };
      }
      case "mock": {
        if (!mockModel) throw new Error("mock model requested but none injected");
        return { model: mockModel(), modelId: key };
      }
      default:
        throw new Error(`Unknown AI provider in model key: ${key}`);
    }
  };
}

function defaultKeyFor(env: AiEnv): string {
  switch (env.AI_PROVIDER ?? "mock") {
    case "anthropic":
      return "anthropic:claude-sonnet-4-5";
    case "local":
      return "local:qwen3:14b";
    default:
      return "mock:default";
  }
}

/**
 * The 'provider:model' key agents fall back to when no per-agent override is
 * set — what the deploy actually runs on by default. Exposed so boot can
 * refuse a production start that silently resolves to the mock provider.
 */
export function defaultModelKey(env: AiEnv): string {
  return env.AI_DEFAULT_MODEL?.trim() || defaultKeyFor(env);
}
