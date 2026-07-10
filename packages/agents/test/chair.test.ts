import type { Causation, ServiceContext } from "@goodstrata/core";
import { meetingsService } from "@goodstrata/core";
import { lots, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { type EventRecord, loadEvent, publishEvent } from "@goodstrata/events";
import { type ConsoleVideoProvider, integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chairAgent } from "../src/agents/chair.js";
import { meetingsAgent } from "../src/agents/meetings.js";
import { createModelResolver } from "../src/models.js";
import { type RuntimeDeps, runAgent } from "../src/runtime.js";
import { type ScriptStep, scriptedModel } from "../src/testing.js";
import type { AgentRunCtx } from "../src/types.js";

let tdb: TestDatabase;
let schemeId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const video = integrations.video as ConsoleVideoProvider;

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

/** One conductor beat: publish the tick event exactly as the boot worker does. */
async function tickEvent(meetingId: string, tick: number): Promise<EventRecord> {
  const result = await meetingsService.conductTick(svc(), schemeId, meetingId, tick);
  expect(result).toEqual({ proceed: true });
  const rows = await tdb.db.query.eventLog.findMany({
    where: (t, { eq }) => eq(t.type, "meeting.conduct.tick"),
    orderBy: (t, { desc }) => desc(t.seq),
  });
  return (await loadEvent(tdb.db, rows[0]!.id))!;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Chair OC",
      planOfSubdivision: "PS777888C",
      addressLine1: "7 Gavel Ln",
      suburb: "Carlton",
      postcode: "3053",
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

describe("chair agent conducts a video meeting", () => {
  let meetingId: string;
  let motionId: string;
  let roomName: string;

  it("startVideoMeeting starts transcription on the console provider", async () => {
    const meeting = await meetingsService.createMeeting(svc(), schemeId, {
      kind: "committee",
      title: "August committee meeting",
      scheduledAt: "2026-08-01T09:00:00.000Z",
      agenda: [{ title: "Gutter cleaning quote" }, { title: "Any other business" }],
    });
    meetingId = meeting.id;
    roomName = meetingsService.videoRoomName(meetingId);
    const motion = await meetingsService.addMotion(svc(), schemeId, {
      meetingId,
      title: "Accept gutter quote",
      text: "That the OC accepts the $450 gutter cleaning quote.",
      resolutionType: "ordinary",
    });
    motionId = motion.id;

    await meetingsService.sendMeetingNotice(svc(), schemeId, meetingId);
    await meetingsService.startVideoMeeting(svc(), schemeId, meetingId);

    const detail = await meetingsService.meetingDetail(svc(), schemeId, meetingId);
    expect(detail.meeting.status).toBe("in_progress");
    expect(detail.transcriptionStarted).toBe(true);
    expect(video.transcribingRooms.has(roomName)).toBe(true);
  });

  it("tick 1: posts welcome guidance to the chair log, room chat, and event log", async () => {
    video.setTranscript(roomName, "Alex Chen: Hi all, shall we get started?");
    const event = await tickEvent(meetingId, 1);

    const note =
      "Welcome to the August committee meeting. Agenda: 1. Gutter cleaning quote, 2. Any other business.";
    const deps = makeDeps([
      { toolCalls: [{ toolName: "postGuidance", input: { kind: "agenda", note } }] },
      { text: "Welcome posted." },
    ]);
    const outcome = await runAgent(deps, chairAgent, event);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.status).toBe("succeeded");

    // The deterministic context carried the meeting facts and transcript tail.
    const run = await tdb.db.query.agentRuns.findFirst({
      where: (t, { eq }) => eq(t.agent, "chair"),
    });
    const context = (run!.input as { context: string }).context;
    expect(context).toContain("August committee meeting");
    expect(context).toContain("Gutter cleaning quote");
    expect(context).toContain("shall we get started?");
    expect(context).toContain("Tick: 1");

    const detail = await meetingsService.meetingDetail(svc(), schemeId, meetingId);
    expect(detail.chairLog).toHaveLength(1);
    expect(detail.chairLog[0]).toMatchObject({ kind: "agenda", note });

    expect(video.chatMessages).toContainEqual({
      roomName,
      text: note,
      fromName: "GoodStrata Chair",
    });

    const noteEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.chair.note"),
    });
    expect(noteEvents).toHaveLength(1);
    expect(noteEvents[0]!.payload).toMatchObject({ meetingId, kind: "agenda", note });
    // Causation links the note to the tick that triggered the run.
    expect(noteEvents[0]!.causationId).toBe(event.id);
  });

  it("tick 2: opens the motion and reminds members to vote (two tools, one tick)", async () => {
    video.setTranscript(
      roomName,
      "Alex Chen: Hi all, shall we get started?\nKim Nguyen: Let's put the gutter quote to a vote.",
    );
    const event = await tickEvent(meetingId, 2);

    const deps = makeDeps([
      {
        toolCalls: [
          { toolName: "openMotion", input: { motionId } },
          {
            toolName: "postGuidance",
            input: { kind: "guidance", note: "Voting is now open on the gutter quote motion." },
          },
        ],
      },
      { text: "Motion opened." },
    ]);
    const outcome = await runAgent(deps, chairAgent, event);
    expect(outcome.kind).toBe("ran");

    const motion = await tdb.db.query.motions.findFirst({
      where: (t, { eq }) => eq(t.id, motionId),
    });
    expect(motion!.status).toBe("open");
  });

  it("tick 3: the agent can only PROPOSE closing the motion — the human chair tallies", async () => {
    video.setTranscript(
      roomName,
      "Kim Nguyen: All done voting.\nAlex Chen: I'll email the contractor tomorrow.",
    );
    const event = await tickEvent(meetingId, 3);

    // The binding tool is gone entirely — not just unadvertised.
    const toolNames = Object.keys(
      chairAgent.tools({ triggerEvent: event } as unknown as AgentRunCtx),
    );
    expect(toolNames).not.toContain("closeMotionAndTally");
    expect(toolNames).toContain("proposeMotionClosure");

    const deps = makeDeps([
      {
        toolCalls: [
          { toolName: "proposeMotionClosure", input: { motionId } },
          {
            toolName: "noteActionItem",
            input: { note: "Alex Chen to email the contractor tomorrow." },
          },
        ],
      },
      { text: "Proposed closing the motion; the chair will tally." },
    ]);
    const outcome = await runAgent(deps, chairAgent, event);
    expect(outcome.kind).toBe("ran");

    // The motion is still OPEN — no tally happened.
    const motion = await tdb.db.query.motions.findFirst({
      where: (t, { eq }) => eq(t.id, motionId),
    });
    expect(motion!.status).toBe("open");
    // …but flagged ready-to-close, with the human chair notified via event.
    expect((motion!.result as { closeProposedAt?: string }).closeProposedAt).toBeTruthy();
    const proposed = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "motion.close.proposed"),
    });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.payload).toMatchObject({ motionId, title: "Accept gutter quote" });

    const detail = await meetingsService.meetingDetail(svc(), schemeId, meetingId);
    const action = detail.chairLog.find((e) => e.kind === "action");
    expect(action?.note).toBe("Alex Chen to email the contractor tomorrow.");
    // The hand-off guidance the tool posts alongside the proposal.
    expect(
      detail.chairLog.some((e) => e.kind === "guidance" && e.note.includes("over to the chair")),
    ).toBe(true);

    // Proposing again is idempotent — one event, no state change.
    const again = await meetingsService.proposeMotionClosure(svc(), schemeId, motionId);
    expect(again.alreadyProposed).toBe(true);

    // The HUMAN chair runs the binding close/tally (the officer-gated route
    // calls this service function).
    const tally = await meetingsService.closeMotion(svc(), schemeId, motionId);
    expect(tally).toBeTruthy();
    const closed = await tdb.db.query.motions.findFirst({
      where: (t, { eq }) => eq(t.id, motionId),
    });
    expect(["carried", "lost"]).toContain(closed!.status);
  });

  it("closing the meeting stores the transcript and the minutes agent drafts from it", async () => {
    const transcript = [
      "Alex Chen: Hi all, shall we get started?",
      "Kim Nguyen: Let's put the gutter quote to a vote.",
      "Alex Chen: I'll email the contractor tomorrow.",
    ].join("\n");
    video.setTranscript(roomName, transcript);

    await meetingsService.closeMeeting(svc(), schemeId, meetingId);
    expect(video.transcribingRooms.has(roomName)).toBe(false);

    const closedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.closed"),
    });
    expect(closedEvents).toHaveLength(1);
    const payload = closedEvents[0]!.payload as { transcriptDocumentId: string | null };
    expect(payload.transcriptDocumentId).toBeTruthy();

    const transcriptDoc = await tdb.db.query.documents.findFirst({
      where: (t, { eq }) => eq(t.id, payload.transcriptDocumentId!),
    });
    expect(transcriptDoc).toMatchObject({
      category: "minutes",
      title: "Meeting transcript",
      accessLevel: "committee",
    });

    // Minutes agent: the discussion transcript is in its deterministic context.
    const event = (await loadEvent(tdb.db, closedEvents[0]!.id))!;
    const minutesMd = [
      "# Minutes — August committee meeting",
      "",
      "## Motion: Accept gutter quote — LOST (for 0, against 0, abstain 0)",
      "",
      "## Discussion",
      "The committee discussed the gutter quote; Alex Chen to email the contractor.",
    ].join("\n");
    const deps = makeDeps([
      { toolCalls: [{ toolName: "saveMinutes", input: { minutesMarkdown: minutesMd } }] },
      { text: "Minutes drafted." },
    ]);
    const outcome = await runAgent(deps, meetingsAgent, event);
    expect(outcome.kind).toBe("ran");

    const minutesRun = await tdb.db.query.agentRuns.findFirst({
      where: (t, { eq }) => eq(t.agent, "meetings"),
    });
    const context = (minutesRun!.input as { context: string }).context;
    expect(context).toContain("Transcript of the discussion");
    expect(context).toContain("Let's put the gutter quote to a vote.");
    // The chair's log rides along too.
    expect(context).toContain("Alex Chen to email the contractor tomorrow.");

    // The LLM draft lands committee-only, awaiting a human officer's approval.
    const detail = await meetingsService.meetingDetail(svc(), schemeId, meetingId);
    expect(detail.meeting.status).toBe("minutes_draft");
    expect(detail.meeting.minutesDocumentId).toBeTruthy();
    const minutesDoc = await tdb.db.query.documents.findFirst({
      where: (t, { eq }) => eq(t.id, detail.meeting.minutesDocumentId!),
    });
    expect(minutesDoc!.accessLevel).toBe("committee");
  });

  it("a stale tick after close is skipped (buildContext returns null)", async () => {
    // The conductor would not publish this; simulate a late-delivered tick.
    const published = await publishEvent(tdb.db, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.conduct.tick",
      payload: { meetingId, tick: 4 },
      actor: systemActor("meeting-conductor"),
    });
    const event = (await loadEvent(tdb.db, published.id))!;

    const deps = makeDeps([{ text: "should never run" }]);
    const outcome = await runAgent(deps, chairAgent, event);
    expect(outcome).toEqual({ kind: "skipped", reason: "buildContext returned null" });

    // And the conductor loop itself refuses to continue.
    const result = await meetingsService.conductTick(svc(), schemeId, meetingId, 5);
    expect(result).toEqual({ proceed: false, reason: "not_in_progress" });
  });
});
