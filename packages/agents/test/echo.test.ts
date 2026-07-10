import type { Causation, ServiceContext } from "@goodstrata/core";
import { schemes } from "@goodstrata/db";
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

beforeAll(async () => {
  tdb = await provisionTestDatabase();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

function makeDeps(script: Parameters<typeof scriptedModel>[0]): RuntimeDeps {
  const integrations = integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  });
  // Mirrors the API's factory: causation (when given) rides the context so
  // service-published events stay causally linked to the trigger.
  const serviceContext = (actor: Actor, causation?: Causation): ServiceContext => ({
    db: tdb.db,
    clock: fixedClock("2026-07-01T00:00:00Z"),
    integrations,
    actor,
    causation,
  });
  return {
    resolveModel: createModelResolver({ AI_PROVIDER: "mock" }, () => scriptedModel(script)),
    serviceContext,
  };
}

async function triggerEvent() {
  // A real scheme row: the welcome announcement the tool creates references it.
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Echo Test OC",
      planOfSubdivision: "PS999999Z",
      addressLine1: "1 Echo Lane",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
      status: "active",
    })
    .returning();
  const schemeId = schemeRows[0]!.id;
  const published = await publishEvent(tdb.db, {
    schemeId,
    stream: `scheme:${schemeId}`,
    type: "scheme.created",
    payload: { name: "Echo Test OC", planOfSubdivision: "PS999999Z", tier: 5 },
    actor: systemActor("test"),
  });
  const event = await loadEvent(tdb.db, published.id);
  if (!event) throw new Error("event not found");
  return event;
}

describe("echo agent via runtime", () => {
  it("runs the tool loop, publishes a mutation event, and records the transcript", async () => {
    const deps = makeDeps([
      { toolCalls: [{ toolName: "postNote", input: { note: "Welcome, Echo Test OC!" } }] },
      { text: "Done — note posted." },
    ]);
    const event = await triggerEvent();

    const outcome = await runAgent(deps, echoAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    // The mutating tool must have appended an announcement event with full causal linkage.
    const rows = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "announcement.published"),
    });
    expect(rows).toHaveLength(1);
    const note = rows[0]!;
    expect(note.causationId).toBe(event.id);
    expect(note.correlationId).toBe(event.correlationId);
    expect(note.causationDepth).toBe(event.causationDepth + 1);
    expect((note.actor as Actor).kind).toBe("agent");
    expect(note.schemeId).toBe(event.schemeId);
    expect(note.payload).toMatchObject({
      title: "Welcome to GoodStrata",
      audience: "all",
      body: "Welcome, Echo Test OC!",
    });

    // …and the announcement is a real published row, not just an event.
    const posted = await tdb.db.query.announcements.findMany({
      where: (t, { eq }) => eq(t.schemeId, event.schemeId!),
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.publishedAt).not.toBeNull();

    // Transcript persisted.
    const run = await tdb.db.query.agentRuns.findFirst({
      where: (t, { eq }) => eq(t.id, outcome.runId),
    });
    expect(run?.status).toBe("succeeded");
    const steps = run?.steps as { toolCalls: { toolName: string }[] }[];
    expect(steps.some((s) => s.toolCalls.some((c) => c.toolName === "postNote"))).toBe(true);
    expect(run?.model).toBe("mock:default");
  });

  it("is idempotent: a second run for the same trigger short-circuits", async () => {
    const deps = makeDeps([{ text: "should not be used" }]);
    const rows = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "scheme.created"),
    });
    const event = await loadEvent(tdb.db, rows[0]!.id);
    const outcome = await runAgent(deps, echoAgent, event!);
    expect(outcome.kind).toBe("skipped");
  });

  it("skips its own events (loop guard)", async () => {
    const deps = makeDeps([{ text: "unused" }]);
    const published = await publishEvent(tdb.db, {
      stream: "scheme:self",
      type: "scheme.created",
      payload: { name: "Self", planOfSubdivision: "PS000001A", tier: 5 },
      actor: { kind: "agent", id: "echo", agentRunId: "some-run" },
    });
    const event = await loadEvent(tdb.db, published.id);
    const outcome = await runAgent(deps, echoAgent, event!);
    expect(outcome).toEqual({ kind: "skipped", reason: "own event (not in selfTriggers)" });
  });

  it("records failures and rethrows for pg-boss retry", async () => {
    const deps: RuntimeDeps = {
      ...makeDeps([]),
      resolveModel: () => {
        throw new Error("no model for you");
      },
    };
    const published = await publishEvent(tdb.db, {
      stream: "scheme:fail",
      type: "scheme.created",
      payload: { name: "Fail OC", planOfSubdivision: "PS000002B", tier: 5 },
      actor: systemActor("test"),
    });
    const event = await loadEvent(tdb.db, published.id);
    await expect(runAgent(deps, echoAgent, event!)).rejects.toThrow("no model for you");
  });
});
