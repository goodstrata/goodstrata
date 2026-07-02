import type { ServiceContext } from "@goodstrata/core";
import { agentRuns } from "@goodstrata/db";
import { type EventRecord, MAX_CAUSATION_DEPTH, publishEvent } from "@goodstrata/events";
import { agentActor, systemActor } from "@goodstrata/shared";
import { generateText, stepCountIs } from "ai";
import { and, eq } from "drizzle-orm";
import type { ModelResolver } from "./models.js";
import type { AgentDefinition, AgentRunCtx, AgentStepRecord } from "./types.js";

/** Backstop: max agent runs per correlation chain. */
export const MAX_RUNS_PER_CORRELATION = 25;

export interface RuntimeDeps {
  resolveModel: ModelResolver;
  /** Builds a ServiceContext with the given actor (db, clock, integrations). */
  serviceContext(actor: Parameters<typeof publishEvent>[1]["actor"]): ServiceContext;
}

export type AgentRunOutcome =
  | { kind: "ran"; runId: string; status: "succeeded" | "awaiting_decision" }
  | { kind: "skipped"; reason: string };

/**
 * Execute one agent against one triggering event. Idempotent under pg-boss
 * retries: attempt 0 is keyed (triggerEventId, agent); a completed run
 * short-circuits, a failed one gets a fresh attempt row.
 */
export async function runAgent(
  deps: RuntimeDeps,
  def: AgentDefinition,
  event: EventRecord,
): Promise<AgentRunOutcome> {
  // Loop guards (the dispatcher also enforces depth; this covers direct calls).
  if (event.causationDepth > MAX_CAUSATION_DEPTH) {
    return { kind: "skipped", reason: "causation depth cap" };
  }
  if (event.actor.kind === "agent" && event.actor.id === def.name) {
    if (!def.selfTriggers?.includes(event.type)) {
      return { kind: "skipped", reason: "own event (not in selfTriggers)" };
    }
  }

  const bootstrapCtx = deps.serviceContext(systemActor(`agent-runtime:${def.name}`));
  const db = bootstrapCtx.db;

  const priorRuns = await db.query.agentRuns.findMany({
    where: eq(agentRuns.correlationId, event.correlationId),
    columns: { id: true },
  });
  if (priorRuns.length >= MAX_RUNS_PER_CORRELATION) {
    return { kind: "skipped", reason: "correlation run cap" };
  }

  // Idempotency: find prior attempts for this (event, agent).
  const attempts = await db.query.agentRuns.findMany({
    where: and(eq(agentRuns.triggerEventId, event.id), eq(agentRuns.agent, def.name)),
    orderBy: (t, { desc }) => desc(t.attempt),
  });
  const latest = attempts[0];
  if (latest && latest.status !== "failed") {
    // succeeded / awaiting_decision / still running from a live worker — don't double-run.
    return { kind: "skipped", reason: `existing run ${latest.id} (${latest.status})` };
  }

  const { model, modelId } = deps.resolveModel(def.name, def.modelKey);

  const contextText = await def.buildContext(
    event,
    deps.serviceContext(systemActor(`agent-context:${def.name}`)),
  );
  if (contextText === null) {
    return { kind: "skipped", reason: "buildContext returned null" };
  }

  const inserted = await db
    .insert(agentRuns)
    .values({
      schemeId: event.schemeId,
      agent: def.name,
      triggerEventId: event.id,
      correlationId: event.correlationId,
      model: modelId,
      status: "running",
      input: { context: contextText, eventType: event.type },
      causationDepth: event.causationDepth,
      attempt: latest ? latest.attempt + 1 : 0,
      retryOf: latest?.id ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: agentRuns.id });
  const runRow = inserted[0];
  if (!runRow) {
    // Concurrent worker won the race for this attempt.
    return { kind: "skipped", reason: "attempt already claimed" };
  }
  const runId = runRow.id;

  const runCtx: AgentRunCtx = {
    runId,
    agent: def.name,
    schemeId: event.schemeId,
    triggerEvent: event,
    services: deps.serviceContext(agentActor(def.name, runId)),
    eventsPublished: 0,
    awaitingDecision: false,
    toolCallSeq: 0,
  };

  const steps: AgentStepRecord[] = [];

  try {
    const result = await generateText({
      model,
      system: def.systemPrompt,
      messages: [{ role: "user", content: contextText }],
      tools: def.tools(runCtx),
      stopWhen: stepCountIs(def.maxSteps ?? 12),
      onStepFinish: async (step) => {
        steps.push({
          index: steps.length,
          text: step.text || null,
          toolCalls: step.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
          toolResults: step.toolResults.map((r) => ({
            toolName: r.toolName,
            output: r.output,
          })),
        });
        // Crash-safe transcript: persist after every step.
        await db.update(agentRuns).set({ steps }).where(eq(agentRuns.id, runId));
      },
    });

    const status = runCtx.awaitingDecision ? "awaiting_decision" : "succeeded";
    await db
      .update(agentRuns)
      .set({
        status,
        steps,
        output: { text: result.text },
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        finishedAt: runCtx.services.clock.now(),
      })
      .where(eq(agentRuns.id, runId));

    await publishEvent(db, {
      schemeId: event.schemeId,
      stream: `agent_run:${runId}`,
      type: "agent.run.completed",
      payload: { agentRunId: runId, agent: def.name, status },
      actor: agentActor(def.name, runId),
      correlationId: event.correlationId,
      causationId: event.id,
      causationDepth: event.causationDepth + 1,
    });

    return { kind: "ran", runId, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(agentRuns)
      .set({ status: "failed", steps, error: message, finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));

    await publishEvent(db, {
      schemeId: event.schemeId,
      stream: `agent_run:${runId}`,
      type: "agent.run.failed",
      payload: { agentRunId: runId, agent: def.name, error: message },
      actor: agentActor(def.name, runId),
      correlationId: event.correlationId,
      causationId: event.id,
      causationDepth: event.causationDepth + 1,
    }).catch(() => {});

    throw err; // let pg-boss retry
  }
}
