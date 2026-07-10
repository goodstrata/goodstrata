import type { ServiceContext } from "@goodstrata/core";
import { agentRuns, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { loadEvent, publishEvent } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { echoAgent } from "../src/agents/echo.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { scriptedModel } from "../src/testing.js";

let tdb: TestDatabase;
let schemeId: string;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Budget OC",
      planOfSubdivision: "PS555444B",
      addressLine1: "1 Ledger Ln",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

/** scriptedModel reports 10 input + 10 output tokens per step (20/step). */
function makeDeps(
  script: Parameters<typeof scriptedModel>[0],
  budgets: Pick<RuntimeDeps, "runTokenBudget" | "schemeDailyTokenBudget"> = {},
): RuntimeDeps {
  const integrations = integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  });
  const serviceContext = (actor: Actor): ServiceContext => ({
    db: tdb.db,
    clock: fixedClock("2026-07-01T00:00:00Z"),
    integrations,
    actor,
  });
  return {
    resolveModel: createModelResolver({ AI_PROVIDER: "mock" }, () => scriptedModel(script)),
    serviceContext,
    ...budgets,
  };
}

async function triggerEvent(streamSuffix: string) {
  const published = await publishEvent(tdb.db, {
    schemeId,
    stream: `scheme:${streamSuffix}`,
    type: "scheme.created",
    payload: { name: "Budget OC", planOfSubdivision: "PS555444B", tier: 5 },
    actor: systemActor("test"),
  });
  const event = await loadEvent(tdb.db, published.id);
  if (!event) throw new Error("event not found");
  return event;
}

describe("agent spend ceilings", () => {
  it("a run that exceeds the per-run token budget fails with a clear error and is not retried", async () => {
    // Budget of 15 < the 20 tokens the very first step consumes.
    const deps = makeDeps(
      [
        { toolCalls: [{ toolName: "postNote", input: { note: "hello" } }] },
        { text: "should never be reached" },
      ],
      { runTokenBudget: 15 },
    );
    const event = await triggerEvent("run-budget");

    // Resolves (no throw → pg-boss will NOT retry) with a terminal failure.
    const outcome = await runAgent(deps, echoAgent, event);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.error).toMatch(/token budget exceeded/i);

    const run = await tdb.db.query.agentRuns.findFirst({
      where: (t, { eq }) => eq(t.id, outcome.runId),
    });
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/AGENT_RUN_TOKEN_BUDGET/);
    // Tokens actually burned are persisted so daily accounting sees them.
    expect((run?.inputTokens ?? 0) + (run?.outputTokens ?? 0)).toBeGreaterThan(0);

    const failedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "agent.run.failed"),
    });
    expect(
      failedEvents.some((e) => (e.payload as { agentRunId: string }).agentRunId === outcome.runId),
    ).toBe(true);
  });

  it("a run under the budget still succeeds", async () => {
    const deps = makeDeps(
      [{ toolCalls: [{ toolName: "postNote", input: { note: "cheap run" } }] }, { text: "done" }],
      { runTokenBudget: 10_000, schemeDailyTokenBudget: 1_000_000 },
    );
    const event = await triggerEvent("under-budget");
    const outcome = await runAgent(deps, echoAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");
  });

  it("a scheme over its daily token budget refuses new runs with a failed run record", async () => {
    // Backfill heavy usage for the scheme today.
    await tdb.db.insert(agentRuns).values({
      schemeId,
      agent: "echo",
      triggerEventId: "00000000-0000-0000-0000-00000000aaaa",
      correlationId: "00000000-0000-0000-0000-00000000bbbb",
      model: "mock:default",
      status: "succeeded",
      inputTokens: 400_000,
      outputTokens: 200_000,
    });

    const deps = makeDeps([{ text: "should never generate" }], {
      schemeDailyTokenBudget: 500_000,
    });
    const event = await triggerEvent("daily-budget");

    const outcome = await runAgent(deps, echoAgent, event);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.error).toMatch(/daily token budget exceeded/i);
    expect(outcome.error).toMatch(/AGENT_SCHEME_DAILY_TOKEN_BUDGET/);

    const run = await tdb.db.query.agentRuns.findFirst({
      where: (t, { eq }) => eq(t.id, outcome.runId),
    });
    expect(run?.status).toBe("failed");
    // The refused run consumed nothing.
    expect(run?.inputTokens).toBe(0);
    expect(run?.outputTokens).toBe(0);
  });
});
