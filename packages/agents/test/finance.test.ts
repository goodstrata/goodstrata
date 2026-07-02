import type { Causation, ServiceContext } from "@goodstrata/core";
import { funds, lots, ownerships, people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { loadEvent, publishEvent } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financeAgent } from "../src/agents/finance.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { type ScriptStep, scriptedModel } from "../src/testing.js";

let tdb: TestDatabase;
let schemeId: string;
let lotId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

function makeDeps(script: ScriptStep[]): RuntimeDeps {
  const serviceContext = (actor: Actor, causation?: Causation): ServiceContext => ({
    db: tdb.db,
    clock: fixedClock("2026-08-31T00:00:00Z"),
    integrations,
    actor,
    causation,
  });
  return {
    resolveModel: createModelResolver({ AI_PROVIDER: "mock" }, () => scriptedModel(script)),
    serviceContext,
  };
}

async function emitStageEvent(stage: number, kind: string) {
  const published = await publishEvent(tdb.db, {
    schemeId,
    stream: `lot:${lotId}`,
    type: "arrears.stage.reached",
    payload: {
      lotId,
      stage,
      kind,
      daysOverdue: stage === 4 ? 61 : 5,
      outstandingCents: 150_000,
      interestAccruedCents: 2_500,
      earliestDueOn: "2026-07-01",
    },
    actor: systemActor("cron.arrears.daily"),
  });
  return (await loadEvent(tdb.db, published.id))!;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Agent Test OC",
      planOfSubdivision: "PS888888A",
      addressLine1: "1 Agent St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;
  await tdb.db.insert(funds).values([
    { schemeId, kind: "admin", name: "Admin" },
    { schemeId, kind: "maintenance", name: "Maintenance" },
  ]);
  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "7", entitlement: 10, liability: 10 })
    .returning();
  lotId = lotRows[0]!.id;
  const personRows = await tdb.db
    .insert(people)
    .values({ schemeId, givenName: "Pat", familyName: "Debtor", email: "pat@example.com" })
    .returning();
  await tdb.db.insert(ownerships).values({
    schemeId,
    lotId,
    personId: personRows[0]!.id,
    startedOn: "2020-01-01",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("finance agent", () => {
  it("stage 1: drafts and sends a reminder; code appends the exact figures", async () => {
    memoryEmail.sent.length = 0;
    const event = await emitStageEvent(1, "friendly_reminder");
    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "sendArrearsEmail",
            input: {
              subject: "A friendly reminder about your levy",
              bodyProse:
                "Hi Pat,\n\nJust a quick note — your recent levy instalment looks unpaid. These things slip by easily! Details below.",
            },
          },
        ],
      },
      { text: "Sent a friendly stage-1 reminder to the owner." },
    ]);

    const outcome = await runAgent(deps, financeAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    expect(memoryEmail.sent).toHaveLength(1);
    const email = memoryEmail.sent[0]!;
    expect(email.to).toBe("pat@example.com");
    // Code-generated statement, not model-generated:
    expect(email.text).toContain("Outstanding levies:      $1,500.00");
    expect(email.text).toContain("Accrued penalty interest: $25.00");

    // message.sent event carries the agent actor and full causal linkage.
    const msgEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "message.sent"),
    });
    expect(msgEvents).toHaveLength(1);
    expect((msgEvents[0]!.actor as Actor).kind).toBe("agent");
    expect(msgEvents[0]!.causationId).toBe(event.id);
    expect(msgEvents[0]!.correlationId).toBe(event.correlationId);
  });

  it("stage 4: opens the committee recovery decision and awaits it", async () => {
    const event = await emitStageEvent(4, "recovery_decision");
    const deps = makeDeps([
      {
        toolCalls: [
          {
            toolName: "requestRecoveryDecision",
            input: {
              whyMd:
                "Lot 7 is **61 days** overdue despite three reminders. Recommend commencing recovery.",
            },
          },
        ],
      },
      { text: "Escalated to the committee for a recovery decision." },
    ]);

    const outcome = await runAgent(deps, financeAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("awaiting_decision");

    const rows = await tdb.db.query.decisions.findMany({
      where: (t, { eq }) => eq(t.schemeId, schemeId),
    });
    expect(rows).toHaveLength(1);
    const decision = rows[0]!;
    expect(decision.kind).toBe("debt_recovery");
    expect(decision.deciderRole).toBe("committee");
    expect(decision.requestedByRunId).toBe(outcome.runId);
    expect(decision.followUp).toMatchObject({
      action: "finance.commenceDebtRecovery",
      args: { lotId },
    });

    // decision.requested event exists exactly once (no double publish).
    const decisionEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "decision.requested"),
    });
    expect(decisionEvents).toHaveLength(1);
  });

  it("skips cleanly when the lot has no reachable owner email", async () => {
    await tdb.db.update(people).set({ email: null }).where(eq(people.schemeId, schemeId));

    const event = await emitStageEvent(2, "formal_reminder");
    const deps = makeDeps([{ text: "unused" }]);
    const outcome = await runAgent(deps, financeAgent, event);
    expect(outcome).toEqual({ kind: "skipped", reason: "buildContext returned null" });
  });
});
