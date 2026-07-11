import { agentRuns, eventLog, memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { agentRunsRoutes } from "./agents.js";

/**
 * Agent-run reads are membership-gated (any role, no officer gate):
 *  - non-members get 404 (scheme existence never leaked)
 *  - the run detail carries the trigger event and the run's effects — the
 *    events it published on the record, excluding agent.run.* lifecycle noise
 *    and other runs' events
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let schemeId: string;
let runId: string;
let triggerEventId: string;

const OWNER = "user-owner-agr";
const OUTSIDER = "user-outsider-agr";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function req(userId: string, path: string) {
  return app.request(`/schemes/${schemeId}${path}`, {
    headers: { "x-test-user": userId },
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  // Fake session: identity from a header; the REAL scheme-membership
  // middleware then runs against the real database (same as app.ts wiring).
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", agentRunsRoutes(deps));

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Agent Runs Route OC",
      planOfSubdivision: "PS888010B",
      addressLine1: "10 Run St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db
    .insert(users)
    .values([OWNER, OUTSIDER].map((id) => ({ id, name: id, email: `${id}@example.com` })));
  await tdb.db
    .insert(memberships)
    .values([{ schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" }]);

  const correlationId = crypto.randomUUID();
  const triggerRows = await tdb.db
    .insert(eventLog)
    .values({
      schemeId,
      stream: "rfq:rfq-1",
      type: "rfq.created",
      payload: { rfqId: "rfq-1" },
      actor: { kind: "user", id: OWNER },
      correlationId,
    })
    .returning({ id: eventLog.id });
  triggerEventId = triggerRows[0]!.id;

  const runRows = await tdb.db
    .insert(agentRuns)
    .values({
      schemeId,
      agent: "maintenance",
      triggerEventId,
      correlationId,
      model: "mock:default",
      status: "succeeded",
      input: { context: "TASK B", eventType: "rfq.created" },
      steps: [],
      output: { text: "done" },
    })
    .returning({ id: agentRuns.id });
  runId = runRows[0]!.id;

  await tdb.db.insert(eventLog).values([
    // The effect the detail must surface.
    {
      schemeId,
      stream: "rfq:rfq-1",
      type: "rfq.spec_drafted",
      payload: { rfqId: "rfq-1" },
      actor: { kind: "agent", id: "maintenance", agentRunId: runId },
      correlationId,
      causationId: triggerEventId,
    },
    // Lifecycle noise: same run actor, agent_run stream — must be excluded.
    {
      schemeId,
      stream: `agent_run:${runId}`,
      type: "agent.run.completed",
      payload: { agentRunId: runId },
      actor: { kind: "agent", id: "maintenance", agentRunId: runId },
      correlationId,
      causationId: triggerEventId,
    },
    // Another run's effect — must be excluded.
    {
      schemeId,
      stream: "rfq:rfq-2",
      type: "rfq.spec_drafted",
      payload: { rfqId: "rfq-2" },
      actor: { kind: "agent", id: "maintenance", agentRunId: crypto.randomUUID() },
      correlationId: crypto.randomUUID(),
    },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it("non-member gets 404 on list and detail", async () => {
    expect((await req(OUTSIDER, "/agent-runs")).status).toBe(404);
    expect((await req(OUTSIDER, `/agent-runs/${runId}`)).status).toBe(404);
  });

  it("any member (owner) can list runs", async () => {
    const res = await req(OWNER, "/agent-runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { id: string }[] };
    expect(body.runs.map((r) => r.id)).toContain(runId);
  });
});

describe("run detail", () => {
  it("returns the run with its trigger event and on-record effects", async () => {
    const res = await req(OWNER, `/agent-runs/${runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { id: string };
      trigger: { type: string; stream: string } | null;
      effects: { type: string; stream: string }[];
    };
    expect(body.run.id).toBe(runId);
    expect(body.trigger).toMatchObject({ type: "rfq.created", stream: "rfq:rfq-1" });
    // Exactly the run's own entity events: no agent.run.* lifecycle rows, no
    // other runs' events.
    expect(body.effects).toHaveLength(1);
    expect(body.effects[0]).toMatchObject({ type: "rfq.spec_drafted", stream: "rfq:rfq-1" });
  });

  it("404s a run from another scheme's URL space", async () => {
    const res = await req(OWNER, "/agent-runs/00000000-0000-7000-8000-000000000000");
    expect(res.status).toBe(404);
  });
});
