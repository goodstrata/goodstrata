import { documentsService, meetingsService } from "@goodstrata/core";
import { documents, meetings, schemes } from "@goodstrata/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

interface ClosedPayload {
  meetingId: string;
  quorumMet: boolean;
  transcriptDocumentId?: string | null;
}

/** How much transcript text the minutes model sees. */
const TRANSCRIPT_CONTEXT_CHARS = 8000;

/**
 * The meetings agent drafts minutes when a meeting closes, from the
 * structured record (agenda, motions, tallies, attendance) plus — when the
 * video meeting was transcribed — the stored transcript, so the minutes
 * reflect the actual discussion.
 *
 * REVIEW GATE: the draft is stored COMMITTEE-ONLY with the meeting flipped to
 * "minutes_draft". Members see nothing until an officer approves via
 * meetingsService.approveMinutes (officer-gated route), which republishes the
 * document owner-visible, sets minutes_distributed, and publishes the
 * minutes.drafted event that notifies every member. LLM-drafted minutes are
 * never member-visible without a human in between.
 */
export const meetingsAgent: AgentDefinition = {
  name: "meetings",
  description: "Drafts meeting minutes from the structured meeting record",
  subscribedEvents: ["meeting.closed"],
  systemPrompt: [
    "You are the minutes secretary for an Australian owners corporation.",
    "A meeting has just closed. From the structured record provided, draft formal minutes in",
    "Markdown: heading with scheme/meeting/date, quorum statement, then each motion with its",
    "text, mover (if known), the entitlement-weighted result (for/against/abstain figures are",
    "provided — copy them exactly), and CARRIED or LOST. Close with a next-meeting placeholder.",
    "If a transcript of the discussion is provided, add a concise 'Discussion' summary for each",
    "agenda item or motion drawn from it, and list any action items you find. When no transcript",
    "is provided, do not invent discussion.",
    "Be accurate and neutral; do not invent attendees, discussion, or figures.",
    "Write plain Markdown only — no XML tags, no <summary> tags.",
    "Call saveMinutes exactly once with the full Markdown, then finish with one line.",
  ].join("\n"),

  async buildContext(event, services) {
    const payload = event.payload as ClosedPayload;
    if (!event.schemeId) return null;
    const scheme = await services.db.query.schemes.findFirst({
      where: eq(schemes.id, event.schemeId),
    });
    const detail = await meetingsService.meetingDetail(services, event.schemeId, payload.meetingId);
    if (!scheme) return null;

    // When the video meeting was transcribed, load the stored transcript so
    // minutes are drafted from the discussion. Best-effort: missing or
    // unreadable transcripts degrade to structured-record-only minutes.
    let transcript: string | null = null;
    if (payload.transcriptDocumentId) {
      try {
        const doc = await services.db.query.documents.findFirst({
          where: and(
            eq(documents.id, payload.transcriptDocumentId),
            eq(documents.schemeId, event.schemeId),
          ),
        });
        if (doc) {
          const bytes = await services.integrations.storage.get(doc.storageKey);
          transcript = new TextDecoder().decode(bytes).slice(0, TRANSCRIPT_CONTEXT_CHARS);
        }
      } catch {
        transcript = null;
      }
    }

    return [
      `Scheme: ${scheme.name} (${scheme.planOfSubdivision})`,
      `Meeting: ${detail.meeting.title} (${detail.meeting.kind.toUpperCase()})`,
      `Held: ${detail.meeting.scheduledAt.toISOString()}`,
      `Location: ${detail.meeting.location ?? "not recorded"}`,
      `Quorum: ${payload.quorumMet ? "achieved" : "NOT achieved"} (${detail.quorum.representedEntitlement}/${detail.quorum.totalEntitlement} entitlements represented)`,
      "",
      "Agenda:",
      ...detail.agenda.map((a) => `  ${a.order}. ${a.title}`),
      "",
      "Motions and results:",
      ...detail.motions.flatMap((m) => {
        const r = m.result as {
          forWeight: number;
          againstWeight: number;
          abstainWeight: number;
        } | null;
        return [
          `- "${m.title}" (${m.resolutionType}): ${m.status.toUpperCase()}`,
          `  Text: ${m.text}`,
          r
            ? `  Tally: for ${r.forWeight}, against ${r.againstWeight}, abstain ${r.abstainWeight}`
            : "  Tally: not put to a vote",
        ];
      }),
      ...(detail.chairLog.length > 0
        ? [
            "",
            "Chair log (notes the AI chair posted during the meeting):",
            ...detail.chairLog.map((e) => `  [${e.kind}] ${e.note}`),
          ]
        : []),
      ...(transcript
        ? [
            "",
            `Transcript of the discussion (first ${TRANSCRIPT_CONTEXT_CHARS} characters):`,
            transcript,
          ]
        : []),
    ].join("\n");
  },

  tools(ctx) {
    const payload = ctx.triggerEvent.payload as ClosedPayload;
    return {
      saveMinutes: defineAgentTool(ctx, {
        description:
          "Store the drafted minutes as a committee-only draft attached to the meeting. " +
          "An officer reviews and approves before members see anything.",
        inputSchema: z.object({ minutesMarkdown: z.string().min(50) }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          // Committee-only until a human approves (meetingsService.approveMinutes
          // republishes at "owners", flips to minutes_distributed, and publishes
          // the member-facing minutes.drafted event at THAT point — not here).
          const doc = await documentsService.uploadDocument(ctx.services, ctx.schemeId, {
            filename: `minutes-${payload.meetingId}.md`,
            contentType: "text/markdown",
            content: new TextEncoder().encode(input.minutesMarkdown),
            category: "minutes",
            title: "Draft minutes",
            accessLevel: "committee",
          });
          await ctx.services.db
            .update(meetings)
            .set({ minutesDocumentId: doc.id, status: "minutes_draft" })
            .where(and(eq(meetings.id, payload.meetingId), eq(meetings.schemeId, ctx.schemeId)));
          return { ok: true, documentId: doc.id, awaitingApproval: true };
        },
      }),
    };
  },
  maxSteps: 3,
};
