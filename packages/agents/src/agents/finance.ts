import {
  arrearsService,
  commsService,
  decisionsService,
  finalFeeNoticesService,
} from "@goodstrata/core";
import { lots, schemes } from "@goodstrata/db";
import { addDays, formatCents } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineAgentTool } from "../tool-factory.js";
import type { AgentDefinition } from "../types.js";

interface ArrearsPayload {
  lotId: string;
  stage: number;
  kind: string;
  daysOverdue: number;
  outstandingCents: number;
  interestAccruedCents: number;
}

/**
 * The finance agent handles arrears correspondence. The ladder (which stage,
 * when) is code; the agent drafts the human-facing words and opens the
 * day-60 committee gate. Exact figures are appended to every email by code —
 * the model writes prose, it does not originate amounts.
 */
export const financeAgent: AgentDefinition = {
  name: "finance",
  description: "Drafts arrears reminders and escalates debt recovery decisions",
  subscribedEvents: ["arrears.stage.reached"],
  systemPrompt: [
    "You are the finance agent for an Australian owners corporation, handling levy arrears",
    "correspondence under the Owners Corporations Act 2006 (Vic).",
    "You will receive the facts of one lot's arrears (stage, days overdue, amounts, owner name).",
    "Rules:",
    "- Stage 1 (friendly_reminder): call sendArrearsEmail once with a warm, brief nudge — people",
    "  forget; assume good faith.",
    "- Stage 2 (formal_reminder): call sendArrearsEmail once, firmer, note that penalty interest",
    "  is accruing.",
    "- Stage 3 (final_notice): call issueFinalFeeNotice once. This creates and serves the approved",
    "  statutory final fee notice; do not substitute an ordinary arrears email.",
    "- Stage 4 (recovery_decision): do NOT email the owner. Call requestRecoveryDecision once so",
    "  the committee decides whether to commence recovery.",
    "An exact statement of amounts is appended to every email automatically — do not invent or",
    "repeat figures in your prose beyond what is provided. Keep emails under 150 words.",
    "Call exactly one tool, then finish with a one-line summary.",
  ].join("\n"),

  async buildContext(event, services) {
    const payload = event.payload as ArrearsPayload;
    if (!event.schemeId) return null;

    const scheme = await services.db.query.schemes.findFirst({
      where: eq(schemes.id, event.schemeId),
    });
    const lot = await services.db.query.lots.findFirst({
      where: and(eq(lots.id, payload.lotId), eq(lots.schemeId, event.schemeId)),
    });
    const recipient = await arrearsService.levyRecipient(services, event.schemeId, payload.lotId);
    if (!scheme || !lot) return null;
    if (payload.stage < 4 && !recipient?.email) return null; // nobody to email

    return [
      `Scheme: ${scheme.name} (${scheme.planOfSubdivision})`,
      `Lot: ${lot.lotNumber}`,
      `Owner: ${recipient?.name ?? "Unknown"} <${recipient?.email ?? "no email"}>`,
      `Arrears stage: ${payload.stage} (${payload.kind})`,
      `Days overdue: ${payload.daysOverdue}`,
      `Outstanding levies: ${formatCents(payload.outstandingCents)}`,
      `Accrued penalty interest: ${formatCents(payload.interestAccruedCents)}`,
    ].join("\n");
  },

  tools(ctx) {
    const payload = ctx.triggerEvent.payload as ArrearsPayload;

    return {
      issueFinalFeeNotice: defineAgentTool(ctx, {
        description:
          "Create and serve the approved statutory final fee notice, starting its 28-day recovery standstill. Stage 3 only.",
        inputSchema: z.object({}),
        mutates: true,
        async execute() {
          if (!ctx.schemeId) throw new Error("no scheme");
          const notice = await finalFeeNoticesService.issueFinalFeeNotice(
            ctx.services,
            ctx.schemeId,
            payload.lotId,
            { serviceMethod: "email" },
          );
          return { ok: true, finalFeeNoticeId: notice.id };
        },
      }),

      sendArrearsEmail: defineAgentTool(ctx, {
        description:
          "Send the arrears email for this lot. Provide subject and body prose; the exact " +
          "amounts table is appended automatically.",
        inputSchema: z.object({
          subject: z.string().max(150),
          bodyProse: z.string().max(2000),
        }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          const recipient = await arrearsService.levyRecipient(
            ctx.services,
            ctx.schemeId,
            payload.lotId,
          );
          if (!recipient?.email) throw new Error("lot has no levy recipient email");

          // Code-generated statement block: figures never come from the model.
          const statement = [
            "",
            "----------------------------------------",
            `Outstanding levies:      ${formatCents(payload.outstandingCents)}`,
            `Accrued penalty interest: ${formatCents(payload.interestAccruedCents)}`,
            `Total payable:           ${formatCents(payload.outstandingCents + payload.interestAccruedCents)}`,
            `Days overdue:            ${payload.daysOverdue}`,
            "----------------------------------------",
          ].join("\n");

          // commsService publishes message.sent inside its transaction with
          // the agent actor + causation from the run's ServiceContext.
          await commsService.sendEmail(ctx.services, {
            schemeId: ctx.schemeId,
            personId: recipient.personId,
            to: recipient.email,
            subject: input.subject,
            body: input.bodyProse + statement,
            template: `arrears_stage_${payload.stage}`,
            related: { type: "lot", id: payload.lotId },
          });
          return { ok: true, to: recipient.email };
        },
      }),

      requestRecoveryDecision: defineAgentTool(ctx, {
        description:
          "Open the committee decision gate to commence debt recovery for this lot (stage 4 only).",
        inputSchema: z.object({
          whyMd: z
            .string()
            .max(2000)
            .describe("Markdown summary for the committee: history and recommendation"),
        }),
        mutates: true,
        async execute(input) {
          if (!ctx.schemeId) throw new Error("no scheme");
          const decision = await decisionsService.requestDecision(ctx.services, {
            schemeId: ctx.schemeId,
            kind: "debt_recovery",
            title: `Commence debt recovery — lot in arrears ${payload.daysOverdue} days`,
            summaryMd: input.whyMd,
            evidence: [
              {
                outstandingCents: payload.outstandingCents,
                interestAccruedCents: payload.interestAccruedCents,
                daysOverdue: payload.daysOverdue,
              },
            ],
            subject: { type: "lot", id: payload.lotId },
            deciderRole: "committee",
            dueAt: addDays(ctx.services.clock.now(), 14),
            followUp: {
              type: "action",
              action: "finance.commenceDebtRecovery",
              args: { lotId: payload.lotId },
            },
            requestedByRunId: ctx.runId,
          });
          ctx.awaitingDecision = true;
          return { ok: true, decisionId: decision.id };
        },
      }),
    };
  },
  maxSteps: 4,
};
