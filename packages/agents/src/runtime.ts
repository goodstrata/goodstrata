import type { Causation, ServiceContext } from "@goodstrata/core";
import { agentRuns } from "@goodstrata/db";
import { type EventRecord, MAX_CAUSATION_DEPTH, publishEvent } from "@goodstrata/events";
import { type Actor, agentActor, systemActor } from "@goodstrata/shared";
import { generateText, stepCountIs } from "ai";
import { and, eq, gte, sql } from "drizzle-orm";
import type { ModelResolver } from "./models.js";
import type { AgentDefinition, AgentRunCtx, AgentStepRecord } from "./types.js";

/** Backstop: max agent runs per correlation chain. */
export const MAX_RUNS_PER_CORRELATION = 25;

/**
 * Spend ceilings. Recursion caps (above + causation depth) bound HOW OFTEN
 * agents run; these bound HOW MUCH each run — and each scheme per day — may
 * consume. Overridable via RuntimeDeps (wired from AGENT_RUN_TOKEN_BUDGET /
 * AGENT_SCHEME_DAILY_TOKEN_BUDGET in the API env).
 */
export const DEFAULT_RUN_TOKEN_BUDGET = 200_000;
export const DEFAULT_SCHEME_DAILY_TOKEN_BUDGET = 2_000_000;

export interface RuntimeDeps {
  resolveModel: ModelResolver;
  /**
   * Builds a ServiceContext with the given actor (db, clock, integrations).
   * When `causation` is provided, every event a service publishes on the
   * agent's behalf is linked to the triggering event automatically.
   */
  serviceContext(actor: Actor, causation?: Causation): ServiceContext;
  /** Max tokens (input+output) one run may consume before it is failed. */
  runTokenBudget?: number;
  /** Max tokens all of a scheme's runs may consume per UTC day. */
  schemeDailyTokenBudget?: number;
}

export type AgentRunOutcome =
  | { kind: "ran"; runId: string; status: "succeeded" | "awaiting_decision" }
  | { kind: "skipped"; reason: string }
  /** Failed terminally (e.g. token budget) — recorded, NOT retried. */
  | { kind: "failed"; runId: string; error: string };

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

  // Spend ceiling #1: the scheme's daily token budget. Checked up front so an
  // exhausted scheme fails fast (recorded run + agent.run.failed, no retry —
  // retrying cannot help until the day rolls over).
  const runTokenBudget = deps.runTokenBudget ?? DEFAULT_RUN_TOKEN_BUDGET;
  const schemeDailyTokenBudget = deps.schemeDailyTokenBudget ?? DEFAULT_SCHEME_DAILY_TOKEN_BUDGET;
  if (event.schemeId) {
    const now = bootstrapCtx.clock.now();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const usageRows = await db
      .select({
        total: sql<number>`coalesce(sum(${agentRuns.inputTokens} + ${agentRuns.outputTokens}), 0)::int`,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.schemeId, event.schemeId), gte(agentRuns.startedAt, dayStart)));
    const usedToday = usageRows[0]?.total ?? 0;
    if (usedToday >= schemeDailyTokenBudget) {
      const error = `Scheme daily token budget exceeded: ${usedToday} tokens used today >= budget of ${schemeDailyTokenBudget} (AGENT_SCHEME_DAILY_TOKEN_BUDGET); run refused`;
      const failedRows = await db
        .insert(agentRuns)
        .values({
          schemeId: event.schemeId,
          agent: def.name,
          triggerEventId: event.id,
          correlationId: event.correlationId,
          model: modelId,
          status: "failed",
          error,
          causationDepth: event.causationDepth,
          attempt: latest ? latest.attempt + 1 : 0,
          retryOf: latest?.id ?? null,
          finishedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: agentRuns.id });
      const failedRun = failedRows[0];
      if (!failedRun) return { kind: "skipped", reason: "attempt already claimed" };
      await publishEvent(db, {
        schemeId: event.schemeId,
        stream: `agent_run:${failedRun.id}`,
        type: "agent.run.failed",
        payload: { agentRunId: failedRun.id, agent: def.name, error },
        actor: agentActor(def.name, failedRun.id),
        correlationId: event.correlationId,
        causationId: event.id,
        causationDepth: event.causationDepth + 1,
      }).catch(() => {});
      return { kind: "failed", runId: failedRun.id, error };
    }
  }

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
    services: deps.serviceContext(agentActor(def.name, runId), {
      correlationId: event.correlationId,
      causationId: event.id,
      causationDepth: event.causationDepth + 1,
    }),
    eventsPublished: 0,
    awaitingDecision: false,
    toolCallSeq: 0,
  };

  const steps: AgentStepRecord[] = [];
  // Running usage tally, persisted on success AND failure so the scheme's
  // daily budget accounting sees every token actually burned.
  let usedInputTokens = 0;
  let usedOutputTokens = 0;

  const overRunBudget = () => usedInputTokens + usedOutputTokens > runTokenBudget;

  try {
    const result = await generateText({
      model,
      system: def.systemPrompt,
      messages: [{ role: "user", content: contextText }],
      tools: def.tools(runCtx),
      // Spend ceiling #2: the per-run token budget stops the tool loop as soon
      // as the accumulated usage crosses it (checked between steps — the loop
      // can overshoot by at most one step). The SDK swallows callback errors,
      // so this is a stop condition, not a throw; the check after generateText
      // turns the overrun into a terminal failure.
      stopWhen: [stepCountIs(def.maxSteps ?? 12), () => overRunBudget()],
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
        usedInputTokens += step.usage.inputTokens ?? 0;
        usedOutputTokens += step.usage.outputTokens ?? 0;
        // Crash-safe transcript: persist after every step.
        await db.update(agentRuns).set({ steps }).where(eq(agentRuns.id, runId));
      },
    });

    if (overRunBudget()) {
      const error = `Agent run token budget exceeded: ${usedInputTokens + usedOutputTokens} tokens used > budget of ${runTokenBudget} (AGENT_RUN_TOKEN_BUDGET); run aborted`;
      await db
        .update(agentRuns)
        .set({
          status: "failed",
          steps,
          error,
          inputTokens: usedInputTokens,
          outputTokens: usedOutputTokens,
          finishedAt: runCtx.services.clock.now(),
        })
        .where(eq(agentRuns.id, runId));
      await publishEvent(db, {
        schemeId: event.schemeId,
        stream: `agent_run:${runId}`,
        type: "agent.run.failed",
        payload: { agentRunId: runId, agent: def.name, error },
        actor: agentActor(def.name, runId),
        correlationId: event.correlationId,
        causationId: event.id,
        causationDepth: event.causationDepth + 1,
      }).catch(() => {});
      // Terminal: a retry would burn the same tokens for the same result — the
      // run is recorded failed with a clear error, and pg-boss must NOT retry.
      return { kind: "failed", runId, error };
    }

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
      .set({
        status: "failed",
        steps,
        error: message,
        inputTokens: usedInputTokens,
        outputTokens: usedOutputTokens,
        finishedAt: runCtx.services.clock.now(),
      })
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
