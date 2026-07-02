import { lots, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { formatCents } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { arrearsForScheme, levyRecipient } from "./arrears.js";
import { sendEmail } from "./comms.js";
import { registerDecisionAction } from "./decisions.js";

/**
 * Executor for the day-60 committee decision: on approval, code (not the
 * LLM) sends the formal demand letter and records commencement. SPEC §2.3
 * day-90 external referral hangs off this event later.
 */
registerDecisionAction("finance.commenceDebtRecovery", async (ctx, args, decision) => {
  const { lotId } = z.object({ lotId: z.string() }).parse(args);
  const schemeId = decision.schemeId;

  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  const lot = await ctx.db.query.lots.findFirst({
    where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)),
  });
  if (!scheme || !lot) return;

  const arrears = (await arrearsForScheme(ctx, schemeId)).find((a) => a.lotId === lotId);
  if (!arrears) return; // paid up since the decision was made — nothing to recover

  await ctx.db.transaction(async (tx) => {
    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "arrears.recovery.commenced",
      payload: { lotId, decisionId: decision.id },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  const recipient = await levyRecipient(ctx, schemeId, lotId);
  if (recipient?.email) {
    await sendEmail(ctx, {
      schemeId,
      personId: recipient.personId,
      to: recipient.email,
      subject: `FORMAL DEMAND — outstanding levies, lot ${lot.lotNumber}, ${scheme.name}`,
      template: "formal_demand",
      related: { type: "lot", id: lotId },
      body: [
        `Dear ${recipient.name ?? "Owner"},`,
        "",
        `Despite previous reminders, levies for lot ${lot.lotNumber} at ${scheme.name} remain unpaid.`,
        "",
        `Outstanding levies: ${formatCents(arrears.outstandingCents)}`,
        `Accrued penalty interest: ${formatCents(arrears.interestAccruedCents)}`,
        `Total now payable: ${formatCents(arrears.outstandingCents + arrears.interestAccruedCents)}`,
        "",
        "The owners corporation has resolved to commence debt recovery. Unless payment in full is",
        "received within 14 days, the matter may be referred for recovery action under the Owners",
        "Corporations Act 2006 (Vic), and recovery costs may be added to your lot account.",
        "",
        "If you are experiencing hardship, contact the committee to discuss a payment plan.",
        "",
        `${scheme.name} — powered by GoodStrata`,
      ].join("\n"),
    });
  }
});

export const RECOVERY_ACTIONS_REGISTERED = true;
