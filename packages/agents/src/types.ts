import type { ServiceContext } from "@goodstrata/core";
import type { EventRecord } from "@goodstrata/events";
import type { AgentName } from "@goodstrata/shared";
import type { ToolSet } from "ai";

/**
 * Per-run context handed to tools. Tools publish events and request decisions
 * through this — never directly.
 */
export interface AgentRunCtx {
  runId: string;
  agent: AgentName;
  schemeId: string | null;
  triggerEvent: EventRecord;
  services: ServiceContext;
  /**
   * Informational per-run counter, incremented by `agentPublish`. Nothing
   * reads or enforces it today — kept for future telemetry/assertions. The
   * "mutating tools must record what they did" rule (see tool-factory.ts) is
   * a convention, not a runtime check.
   */
  eventsPublished: number;
  /** Set when a decision gate was opened; the run ends `awaiting_decision`. */
  awaitingDecision: boolean;
  /**
   * Per-run publish counter — incremented by `agentPublish` only, NOT per
   * tool call (defineAgentTool never touches it). Combined with runId to
   * build the dedupe key so pg-boss retries can't double-publish. Changing
   * when it increments shifts dedupe keys between retry attempts.
   */
  toolCallSeq: number;
}

export interface AgentDefinition {
  name: AgentName;
  description: string;
  /** Event types that trigger a run. */
  subscribedEvents: readonly string[];
  /** Own-event types this agent may react to (default: none — loop guard). */
  selfTriggers?: readonly string[];
  systemPrompt: string;
  /**
   * Deterministic fact-gathering — no LLM. The returned string becomes the
   * user message. Return null to skip the run entirely (cheap pre-filter).
   */
  buildContext(event: EventRecord, services: ServiceContext): Promise<string | null>;
  /** Tools are constructed per-run so they can close over the run context. */
  tools(ctx: AgentRunCtx): ToolSet;
  /**
   * Model key override ('provider:model', e.g. "anthropic:claude-sonnet-4-5"),
   * resolved by models.ts. Beats AI_DEFAULT_MODEL but is itself beaten by an
   * AI_MODEL_<AGENT> env override.
   */
  modelKey?: string;
  maxSteps?: number;
}

export interface AgentStepRecord {
  index: number;
  text: string | null;
  toolCalls: { toolName: string; input: unknown }[];
  toolResults: { toolName: string; output: unknown }[];
}
