import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

/**
 * Scripted mock model for deterministic agent-loop tests and keyless dev.
 * Each entry is one step's generation: tool calls and/or final text.
 */
export interface ScriptStep {
  text?: string;
  toolCalls?: { toolName: string; input: unknown }[];
}

export function scriptedModel(script: ScriptStep[]): LanguageModel {
  let call = 0;
  const options = {
    doGenerate: async () => {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      if (!step) throw new Error("scriptedModel: empty script");

      const content: unknown[] = [];
      if (step.text) content.push({ type: "text", text: step.text });
      for (const [i, tc] of (step.toolCalls ?? []).entries()) {
        content.push({
          type: "tool-call",
          toolCallId: `call-${call}-${i}`,
          toolName: tc.toolName,
          input: JSON.stringify(tc.input),
        });
      }

      return {
        content,
        finishReason: step.toolCalls?.length ? "tool-calls" : "stop",
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        warnings: [],
      };
    },
  };
  // The literal above matches the V3 spec shape; the mock validates at runtime.
  return new MockLanguageModelV3(
    options as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0],
  ) as unknown as LanguageModel;
}

/** A model that always answers with fixed text and never calls tools. */
export function staticTextModel(text = "ok"): LanguageModel {
  return scriptedModel([{ text }]);
}
