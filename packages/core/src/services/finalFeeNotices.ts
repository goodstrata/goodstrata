import { bankAccounts, finalFeeNotices, levyNotices, lots, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { buildFinalFeeNoticePdf, type FinalFeeNoticeDoc } from "@goodstrata/integrations/pdf";
import { addDays, formatCents, toDateOnly } from "@goodstrata/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { amountPanel, emailBrand, infoNote, renderEmail } from "../email/index.js";
import { DomainError, notFound } from "../errors.js";
import { arrearsForScheme, levyRecipient } from "./arrears.js";
import { sendEmail } from "./comms.js";
import { uploadDocument } from "./documents.js";
import { activeInterestAuthorisation } from "./interestAuthorisations.js";

export const issueFinalFeeNoticeInput = z.object({
  serviceMethod: z.enum(["email", "post", "hand", "electronic_portal"]).default("email"),
});

function schemeParty(scheme: typeof schemes.$inferSelect): FinalFeeNoticeDoc["scheme"] {
  return {
    name: scheme.name,
    planOfSubdivision: scheme.planOfSubdivision,
    addressLine1: scheme.addressLine1,
    addressLine2: scheme.addressLine2,
    suburb: scheme.suburb,
    state: scheme.state,
    postcode: scheme.postcode,
    abn: scheme.abn,
    gstRegistered: scheme.gstRegistered,
  };
}

/** Issue and serve the approved-form final notice after the first 28 days expire. */
export async function issueFinalFeeNotice(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  input: z.infer<typeof issueFinalFeeNoticeInput>,
) {
  const [scheme, lot, openNotices, recipient, arrears] = await Promise.all([
    ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
    ctx.db.query.lots.findFirst({ where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)) }),
    ctx.db.query.levyNotices.findMany({
      where: and(
        eq(levyNotices.schemeId, schemeId),
        eq(levyNotices.lotId, lotId),
        inArray(levyNotices.status, ["issued", "partially_paid", "overdue"]),
      ),
      orderBy: (t, { asc }) => asc(t.issuedAt),
    }),
    levyRecipient(ctx, schemeId, lotId),
    arrearsForScheme(ctx, schemeId),
  ]);
  if (!scheme || !lot) throw notFound("Lot");
  const primary = openNotices[0];
  if (!primary?.issuedAt) {
    throw new DomainError("NO_OPEN_FEE_NOTICE", "There is no issued fee notice for this lot", 422);
  }
  const earliestFinalAt = addDays(primary.issuedAt, 28);
  if (ctx.clock.now().getTime() < earliestFinalAt.getTime()) {
    throw new DomainError(
      "FINAL_NOTICE_TOO_EARLY",
      `A final fee notice cannot issue before ${toDateOnly(earliestFinalAt)}`,
      422,
    );
  }
  const existing = await ctx.db.query.finalFeeNotices.findFirst({
    where: eq(finalFeeNotices.levyNoticeId, primary.id),
  });
  if (existing) return existing;
  const lotArrears = arrears.find((row) => row.lotId === lotId);
  if (!lotArrears) {
    throw new DomainError("LOT_NOT_IN_ARREARS", "The lot is no longer in arrears", 422);
  }

  const [trust, authority] = await Promise.all([
    ctx.db.query.bankAccounts.findFirst({
      where: and(eq(bankAccounts.schemeId, schemeId), eq(bankAccounts.kind, "virtual_collection")),
    }),
    activeInterestAuthorisation(ctx, schemeId, toDateOnly(ctx.clock.now())),
  ]);
  const principalCents = lotArrears.outstandingCents;
  const interestCents = lotArrears.interestAccruedCents;
  const rateBps = authority?.rateBps ?? 0;
  const dailyInterestCents = Math.round((principalCents * rateBps) / 10_000 / 365);
  const recoveryEligibleOn = toDateOnly(addDays(ctx.clock.now(), 28));
  const noticeNumber = `FFN-${ctx.clock.now().getUTCFullYear()}-${lot.lotNumber}-${primary.noticeNumber}`;
  const disputeProcess =
    "The owners corporation's internal dispute resolution process applies to disputes about fees and charges. Contact the secretary or manager promptly to lodge a written complaint or discuss hardship and a payment plan.";
  const pdf = await buildFinalFeeNoticePdf({
    scheme: schemeParty(scheme),
    billTo: { name: recipient?.name ?? "Lot owner", email: recipient?.email },
    lot: {
      lotNumber: lot.lotNumber,
      unitNumber: lot.unitNumber,
      streetAddress: lot.streetAddress,
    },
    notice: {
      noticeNumber,
      issuedAt: ctx.clock.now(),
      sourceNoticeNumber: primary.noticeNumber,
      recoveryEligibleOn,
      principalCents,
      interestCents,
      dailyInterestCents,
      interestRateBps: rateBps,
    },
    payment: {
      reference: primary.payid,
      bsb: trust?.bsb ?? null,
      accountNumber: trust?.accountNumber ?? null,
      payid: trust?.payidRoot ?? null,
      accountName: scheme.name,
    },
    disputeProcess,
  });
  const doc = await uploadDocument(ctx, schemeId, {
    filename: `Final-Fee-Notice-${noticeNumber}.pdf`,
    contentType: "application/pdf",
    content: new Uint8Array(pdf),
    category: "levy_notice",
    accessLevel: "admin",
    title: `Final fee notice ${noticeNumber}`,
  });

  const record = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(finalFeeNotices)
      .values({
        schemeId,
        levyNoticeId: primary.id,
        lotId,
        noticeNumber,
        issuedAt: ctx.clock.now(),
        recoveryEligibleOn,
        principalCents,
        interestCents,
        dailyInterestCents,
        interestRateBps: rateBps,
        documentId: doc.id,
        servedAt: ctx.clock.now(),
        serviceMethod: input.serviceMethod,
        serviceRecipient: recipient?.email ?? recipient?.name ?? "lot owner",
      })
      .returning();
    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "levy.final_fee_notice.issued",
      payload: {
        finalFeeNoticeId: rows[0]!.id,
        levyNoticeId: primary.id,
        lotId,
        recoveryEligibleOn,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });

  if (recipient?.email && input.serviceMethod === "email") {
    const total = principalCents + interestCents;
    const { html, text } = renderEmail({
      preheader: `Final fee notice: ${formatCents(total)} now payable for lot ${lot.lotNumber}.`,
      heading: "Final fee notice",
      intro: `Dear ${recipient.name ?? "Owner"}, overdue owners corporation fees for lot ${lot.lotNumber} remain unpaid and are payable immediately.`,
      blocks: [
        amountPanel("Total now payable", formatCents(total), { tone: "critical" }),
        infoNote(
          `If payment in full is not received within 28 days (by ${recoveryEligibleOn}), the owners corporation intends to take legal action to recover the amount due. Penalty interest is currently accruing at approximately ${formatCents(dailyInterestCents)} per day.`,
          "warning",
        ),
        infoNote(disputeProcess),
      ],
      cta: {
        label: "View lot account",
        url: `${emailBrand.urls.app}/schemes/${schemeId}?section=finance`,
      },
    });
    await sendEmail(ctx, {
      schemeId,
      personId: recipient.personId,
      to: recipient.email,
      subject: `FINAL FEE NOTICE — lot ${lot.lotNumber}, ${scheme.name}`,
      template: "final_fee_notice",
      related: { type: "levy_notice", id: primary.id },
      body: text,
      html,
    });
  }
  return record;
}

/** Hard gate used immediately before any recovery action is commenced. */
export async function requireRecoveryEligibleFinalNotice(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
) {
  const notices = await ctx.db.query.finalFeeNotices.findMany({
    where: and(eq(finalFeeNotices.schemeId, schemeId), eq(finalFeeNotices.lotId, lotId)),
    orderBy: (t, { desc }) => desc(t.issuedAt),
  });
  const finalNotice = notices[0];
  if (!finalNotice?.servedAt) {
    throw new DomainError(
      "FINAL_FEE_NOTICE_REQUIRED",
      "A served final fee notice is required before debt recovery can commence",
      422,
    );
  }
  if (toDateOnly(ctx.clock.now()) < finalNotice.recoveryEligibleOn) {
    throw new DomainError(
      "RECOVERY_STANDSTILL",
      `Debt recovery cannot commence before ${finalNotice.recoveryEligibleOn}`,
      422,
    );
  }
  return finalNotice;
}
