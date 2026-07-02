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
  /** Incremented by ctx-aware publishing; the tool factory enforces it. */
  eventsPublished: number;
  /** Set when a decision gate was opened; the run ends `awaiting_decision`. */
  awaitingDecision: boolean;
  /** Monotonic tool-call counter for idempotency keys. */
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
  /** Registry key override, e.g. "anthropic:claude-sonnet-4-5". */
  modelKey?: string;
  maxSteps?: number;
}

export interface AgentStepRecord {
  index: number;
  text: string | null;
  toolCalls: { toolName: string; input: unknown }[];
  toolResults: { toolName: string; output: unknown }[];
}
