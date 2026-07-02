import type { Causation, ServiceContext } from "@goodstrata/core";
import { meetingsService } from "@goodstrata/core";
import { lots, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { loadEvent } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { meetingsAgent } from "../src/agents/meetings.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { type ScriptStep, scriptedModel } from "../src/testing.js";

let tdb: TestDatabase;
let schemeId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function svc(): ServiceContext {
  return {
    db: tdb.db,
    clock: fixedClock("2026-08-01T10:00:00Z"),
    integrations,
    actor: systemActor("test"),
  };
}

function makeDeps(script: ScriptStep[]): RuntimeDeps {
  const serviceContext = (actor: Actor, causation?: Causation): ServiceContext => ({
    ...svc(),
    actor,
    causation,
  });
  return {
    resolveModel: createModelResolver({ AI_PROVIDER: "mock" }, () => scriptedModel(script)),
    serviceContext,
  };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Minutes OC",
      planOfSubdivision: "PS444333Q",
      addressLine1: "3 Quill St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(lots).values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("meetings agent", () => {
  it("drafts minutes from the structured record and attaches them", async () => {
    const meeting = await meetingsService.createMeeting(svc(), schemeId, {
      kind: "committee",
      title: "July committee meeting",
      scheduledAt: "2026-08-01T09:00:00.000Z",
      agenda: [{ title: "Gutter cleaning quote" }],
    });
    const motion = await meetingsService.addMotion(svc(), schemeId, {
      meetingId: meeting.id,
      title: "Accept gutter quote",
      text: "That the OC accepts the $450 gutter cleaning quote.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(svc(), schemeId, motion.id);
    await meetingsService.closeMotion(svc(), schemeId, motion.id);
    await meetingsService.closeMeeting(svc(), schemeId, meeting.id);

    const closedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.closed"),
    });
    const event = (await loadEvent(tdb.db, closedEvents[0]!.id))!;

    const minutesMd = [
      "# Minutes — July committee meeting",
      "",
      "Quorum: not achieved (0/10 entitlements represented).",
      "",
      "## Motion: Accept gutter quote",
      "That the OC accepts the $450 gutter cleaning quote. — LOST (for 0, against 0, abstain 0)",
    ].join("\n");

    const deps = makeDeps([
      { toolCalls: [{ toolName: "saveMinutes", input: { minutesMarkdown: minutesMd } }] },
      { text: "Minutes drafted and attached." },
    ]);
    const outcome = await runAgent(deps, meetingsAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    const detail = await meetingsService.meetingDetail(svc(), schemeId, meeting.id);
    expect(detail.meeting.status).toBe("minutes_distributed");
    expect(detail.meeting.minutesDocumentId).toBeTruthy();

    // The stored document round-trips.
    const docs = await tdb.db.query.documents.findMany({
      where: (t, { eq }) => eq(t.category, "minutes"),
    });
    expect(docs).toHaveLength(1);
    const stored = await integrations.storage.get(docs[0]!.storageKey);
    expect(new TextDecoder().decode(stored)).toContain("Accept gutter quote");

    // minutes.drafted event linked to the meeting.closed trigger.
    const drafted = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "minutes.drafted"),
    });
    expect(drafted).toHaveLength(1);
    expect(drafted[0]!.causationId).toBe(event.id);
  });
});
