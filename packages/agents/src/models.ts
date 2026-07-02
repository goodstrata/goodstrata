import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface AiEnv {
  AI_PROVIDER?: string; // anthropic | local | mock
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
    const envOverride = env[`AI_MODEL_${agentName.toUpperCase()}`];
    const key = envOverride ?? modelKeyOverride ?? env.AI_DEFAULT_MODEL ?? defaultKeyFor(env);

    const [provider, ...rest] = key.split(":");
    const modelName = rest.join(":");

    switch (provider) {
      case "anthropic": {
        if (!env.ANTHROPIC_API_KEY) {
          throw new Error("AI_PROVIDER anthropic requires ANTHROPIC_API_KEY");
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
