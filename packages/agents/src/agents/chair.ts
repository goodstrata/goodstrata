import { meetingsService } from "@goodstrata/core";
import { schemes } from "@goodstrata/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

interface TickPayload {
  meetingId: string;
  tick: number;
}

/** How much of the transcript's tail the model sees each tick. */
const TRANSCRIPT_TAIL_CHARS = 2000;
/** How many recent chair-log entries the model sees each tick. */
const CHAIR_LOG_TAIL = 10;

/**
 * The AI chair conducts a live video meeting. Code owns the clock — the
 * conductor loop publishes a meeting.conduct.tick every minute while the
 * meeting is in progress — and the model owns the conducting: it reads the
 * agenda, motions and transcript tail and decides what (if anything) to say
 * or do this tick.
 */
export const chairAgent: AgentDefinition = {
  name: "chair",
  description: "Conducts live video meetings: agenda, guidance, motions, action items",
  subscribedEvents: ["meeting.conduct.tick"],
  systemPrompt: [
    "You are the neutral chair of an Australian owners-corporation meeting, participating via",
    "the meeting chat. Each message you receive is one tick (about a minute apart) with the",
    "current state and the latest transcript excerpt.",
    "Rules:",
    "- On tick 1: post a short welcome and read out the agenda (postGuidance kind 'agenda').",
    "- Keep the meeting moving through the agenda items; when discussion of an item seems",
    "  finished, guide the members to the next one.",
    "- If a motion is open, remind members to cast their votes; when the transcript suggests",
    "  discussion is done, call closeMotionAndTally. Open draft motions with openMotion when",
    "  their agenda item comes up.",
    "- When you hear an action item in the transcript (someone agreeing to do something), record",
    "  it with noteActionItem.",
    "- Keep every guidance note under 60 words. Be neutral — never take sides on a motion.",
    "- Call at most 2 tools per tick.",
    "- If the transcript shows no new activity, post nothing: it is fine to end a tick with no",
    "  tool calls at all. Do not repeat guidance you already gave (see the chair log).",
    "- Write plain Markdown text only — no XML tags, no <summary> tags.",
  ].join("\n"),

  async buildContext(event, services) {
    const payload = event.payload as TickPayload;
    if (!event.schemeId) return null;

    const scheme = await services.db.query.schemes.findFirst({
      where: eq(schemes.id, event.schemeId),
    });
    if (!scheme) return null;
    const detail = await meetingsService.meetingDetail(services, event.schemeId, payload.meetingId);
    // The meeting may have closed between the tick being scheduled and now.
    if (detail.meeting.status !== "in_progress") return null;

    // Transcript tail: fetch the whole thing, show the last ~2000 chars.
    // (Simple by design — no offset bookkeeping.)
    let transcriptTail: string | null = null;
    if (detail.transcriptionStarted && services.integrations.video.fetchTranscriptText) {
      try {
        const full = await services.integrations.video.fetchTranscriptText(
          meetingsService.videoRoomName(payload.meetingId),
        );
        if (full) transcriptTail = full.slice(-TRANSCRIPT_TAIL_CHARS);
      } catch {
        transcriptTail = null;
      }
    }

    const elapsedMinutes = Math.max(
      0,
      Math.round((services.clock.now().getTime() - detail.meeting.scheduledAt.getTime()) / 60_000),
    );
    const recentLog = detail.chairLog.slice(-CHAIR_LOG_TAIL);

    return [
      `Scheme: ${scheme.name}`,
      `Meeting: ${detail.meeting.title} (${detail.meeting.kind.toUpperCase()})`,
      `Tick: ${payload.tick} — about ${elapsedMinutes} minute(s) since the scheduled start`,
      `Quorum: ${detail.quorum.quorate ? "achieved" : "NOT achieved"} (${detail.quorum.representedEntitlement}/${detail.quorum.totalEntitlement} entitlements represented)`,
      "",
      "Agenda:",
      ...(detail.agenda.length > 0
        ? detail.agenda.map((a) => `  ${a.order}. ${a.title}`)
        : ["  (no agenda items)"]),
      "",
      "Motions:",
      ...(detail.motions.length > 0
        ? detail.motions.map(
            (m) => `  - [id ${m.id}] "${m.title}" (${m.resolutionType}): ${m.status}`,
          )
        : ["  (no motions)"]),
      "",
      `Chair log so far (last ${CHAIR_LOG_TAIL}):`,
      ...(recentLog.length > 0
        ? recentLog.map((e) => `  [${e.kind}] ${e.note}`)
        : ["  (nothing posted yet)"]),
      "",
      transcriptTail
        ? `Transcript (latest ${TRANSCRIPT_TAIL_CHARS} characters):\n${transcriptTail}`
        : "Transcript: not available this tick.",
    ].join("\n");
  },

  tools(ctx) {
    const payload = ctx.triggerEvent.payload as TickPayload;
    const requireScheme = () => {
      if (!ctx.schemeId) throw new Error("no scheme");
      return ctx.schemeId;
    };

    return {
      postGuidance: defineAgentTool(ctx, {
        description:
          "Post a chair note to the meeting: appended to the chair log and shown in the " +
          "room chat as 'GoodStrata Chair'. Keep it under 60 words.",
        inputSchema: z.object({
          kind: z.enum(["guidance", "agenda", "info"]),
          note: z.string().min(1).max(600),
        }),
        mutates: true,
        async execute(input) {
          const entry = await meetingsService.chairNote(
            ctx.services,
            requireScheme(),
            payload.meetingId,
            { kind: input.kind, note: input.note },
          );
          return { ok: true, entry };
        },
      }),

      openMotion: defineAgentTool(ctx, {
        description: "Open voting on a draft motion (use the motion id from the context).",
        inputSchema: z.object({ motionId: z.string() }),
        mutates: true,
        async execute(input) {
          await meetingsService.openMotion(ctx.services, requireScheme(), input.motionId);
          return { ok: true, motionId: input.motionId };
        },
      }),

      closeMotionAndTally: defineAgentTool(ctx, {
        description: "Close voting on an open motion and tally the result (entitlement-weighted).",
        inputSchema: z.object({ motionId: z.string() }),
        mutates: true,
        async execute(input) {
          const tally = await meetingsService.closeMotion(
            ctx.services,
            requireScheme(),
            input.motionId,
          );
          return { ok: true, tally };
        },
      }),

      noteActionItem: defineAgentTool(ctx, {
        description:
          "Record an action item heard in the discussion (who agreed to do what). " +
          "Appended to the chair log and shown in the room chat.",
        inputSchema: z.object({ note: z.string().min(1).max(600) }),
        mutates: true,
        async execute(input) {
          const entry = await meetingsService.chairNote(
            ctx.services,
            requireScheme(),
            payload.meetingId,
            { kind: "action", note: input.note },
          );
          return { ok: true, entry };
        },
      }),
    };
  },
  maxSteps: 4,
};
