import {
  budgetLines,
  budgets,
  type DbHandle,
  levyNoticeLines,
  levyNotices,
  levySchedules,
  lotLedgerEntries,
  lots,
  ownerships,
  paymentAllocations,
  people,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { buildLevyNoticePdf, type LevyNoticeDoc } from "@goodstrata/integrations/pdf";
import {
  addDays,
  addMonthsDateOnly,
  formatCents,
  type LevyFrequency,
  toDateOnly,
} from "@goodstrata/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import {
  amountPanel,
  emailBrand,
  infoNote,
  keyValueTable,
  paragraph,
  renderEmail,
} from "../email/index.js";
import { calculateLevyRun } from "../engines/levy-calc.js";
import { DomainError, notFound } from "../errors.js";
import { getAdoptedBudgetFunds } from "./budgets.js";
import { sendEmail } from "./comms.js";
import { uploadDocument } from "./documents.js";
import { activeInterestAuthorisation } from "./interestAuthorisations.js";
import { requireCarriedResolution } from "./resolutionValidation.js";
import { ensureSchemeTrustAccount } from "./trustAccounts.js";

const INSTALMENTS: Record<LevyFrequency, number> = {
  quarterly: 4,
  half_yearly: 2,
  annual: 1,
};
const MONTHS_BETWEEN: Record<LevyFrequency, number> = {
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

export const createLevyScheduleInput = z.object({
  budgetId: z.string(),
  frequency: z.enum(["quarterly", "half_yearly", "annual"]).default("quarterly"),
  firstDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateLevyScheduleInput = z.infer<typeof createLevyScheduleInput>;

export const createSpecialFeeInput = z
  .object({
    description: z.string().trim().min(3).max(500),
    totalCents: z.number().int().positive(),
    fundKind: z.enum(["admin", "maintenance"]).default("admin"),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motionId: z.string().uuid(),
    allocationMethod: z.enum(["liability", "benefit"]).default("liability"),
    benefitWeights: z
      .array(z.object({ lotId: z.string().uuid(), weight: z.number().positive() }))
      .optional(),
  })
  .superRefine((value, ctx) => {
    const ids = value.benefitWeights?.map((item) => item.lotId) ?? [];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["benefitWeights"],
        message: "Each lot may appear once",
      });
    }
  });

export async function createLevySchedule(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateLevyScheduleInput,
) {
  // Validates adoption as a side effect.
  await getAdoptedBudgetFunds(ctx, schemeId, input.budgetId);

  const rows = await ctx.db
    .insert(levySchedules)
    .values({
      schemeId,
      budgetId: input.budgetId,
      frequency: input.frequency,
      instalments: INSTALMENTS[input.frequency],
      firstDueOn: input.firstDueOn,
    })
    .returning();
  return rows[0]!;
}

function allocateByWeight(totalCents: number, weights: { lotId: string; weight: number }[]) {
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    throw new DomainError("INVALID_ALLOCATION", "Allocation weights must be positive", 422);
  }
  const raw = weights.map((item) => ({ ...item, exact: (totalCents * item.weight) / totalWeight }));
  const result = raw.map((item) => ({ lotId: item.lotId, amountCents: Math.floor(item.exact) }));
  const remainder = totalCents - result.reduce((sum, item) => sum + item.amountCents, 0);
  const order = raw
    .map((item, index) => ({
      index,
      fraction: item.exact - Math.floor(item.exact),
      lotId: item.lotId,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.lotId.localeCompare(b.lotId));
  for (let i = 0; i < remainder; i += 1) {
    result[order[i % order.length]!.index]!.amountCents += 1;
  }
  return result;
}

/** Special fees are resolution-gated and snapshot their benefit allocation. */
export async function createSpecialFee(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createSpecialFeeInput>,
) {
  const lotRows = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  if (lotRows.length === 0) throw new DomainError("NO_LOTS", "No lots to levy", 422);
  const minimumDueOn = toDateOnly(addDays(ctx.clock.now(), 28));
  if (input.dueOn < minimumDueOn) {
    throw new DomainError(
      "FEE_NOTICE_28_DAY_FLOOR",
      `The due date must allow at least 28 days (use ${minimumDueOn} or later)`,
      422,
    );
  }
  const adopted = await ctx.db.query.budgets.findMany({
    where: and(eq(budgets.schemeId, schemeId), eq(budgets.status, "adopted")),
    orderBy: (t, { desc }) => desc(t.fiscalYearStart),
  });
  const lines = adopted[0]
    ? await ctx.db.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, adopted[0].id) })
    : [];
  const annualFeesCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const specialResolutionRequired = input.totalCents > annualFeesCents * 2;
  await requireCarriedResolution(ctx, schemeId, input.motionId, {
    minimum: specialResolutionRequired ? "special" : "ordinary",
  });

  let weights: { lotId: string; weight: number }[];
  if (input.allocationMethod === "benefit") {
    if (!input.benefitWeights?.length) {
      throw new DomainError(
        "BENEFIT_ALLOCATION_REQUIRED",
        "Benefit-principle fees require weights for every benefited lot",
        422,
      );
    }
    const schemeLots = new Set(lotRows.map((lot) => lot.id));
    if (input.benefitWeights.some((item) => !schemeLots.has(item.lotId))) {
      throw new DomainError("INVALID_ALLOCATION_LOT", "Allocation references another scheme", 422);
    }
    weights = input.benefitWeights;
  } else {
    weights = lotRows.map((lot) => ({ lotId: lot.id, weight: lot.liability }));
  }
  const allocations = allocateByWeight(input.totalCents, weights);
  const rows = await ctx.db
    .insert(levySchedules)
    .values({
      schemeId,
      budgetId: null,
      feeKind: "special",
      resolutionMotionId: input.motionId,
      description: input.description,
      specialFeeCents: input.totalCents,
      specialFundKind: input.fundKind,
      specialAllocations: allocations,
      frequency: "annual",
      instalments: 1,
      firstDueOn: input.dueOn,
    })
    .returning();
  return {
    ...rows[0]!,
    resolutionThreshold: specialResolutionRequired ? "special" : "ordinary",
  };
}

export async function listSchedules(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.levySchedules.findMany({
    where: eq(levySchedules.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

/**
 * Issue one instalment's levy notices for every lot: deterministic engine
 * apportionment, ledger charges, unique payment references, and emailed
 * notices — all committed together, then emails sent.
 */
export async function issueLevyRun(
  ctx: ServiceContext,
  schemeId: string,
  scheduleId: string,
  instalment: number,
) {
  const schedule = await ctx.db.query.levySchedules.findFirst({
    where: and(eq(levySchedules.id, scheduleId), eq(levySchedules.schemeId, schemeId)),
  });
  if (!schedule) throw notFound("Levy schedule");
  if (instalment < 1 || instalment > schedule.instalments) {
    throw new DomainError(
      "INVALID_INSTALMENT",
      `Instalment must be 1–${schedule.instalments}`,
      422,
    );
  }

  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");

  const annualFunds = schedule.budgetId
    ? await getAdoptedBudgetFunds(ctx, schemeId, schedule.budgetId)
    : null;
  const lotRows = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  if (lotRows.length === 0) throw new DomainError("NO_LOTS", "No lots to levy", 422);

  const existing = await ctx.db.query.levyNotices.findFirst({
    where: and(eq(levyNotices.levyScheduleId, scheduleId), eq(levyNotices.instalment, instalment)),
  });
  if (existing) {
    throw new DomainError("ALREADY_ISSUED", `Instalment ${instalment} is already issued`, 409);
  }

  const run = annualFunds
    ? calculateLevyRun(
        annualFunds,
        lotRows.map((l) => ({ lotId: l.id, liability: l.liability })),
        schedule.instalments,
      ).filter((r) => r.instalment === instalment)
    : (schedule.specialAllocations ?? []).map((allocation) => ({
        lotId: allocation.lotId,
        instalment: 1,
        totalCents: allocation.amountCents,
        lines: [
          {
            fundKind: schedule.specialFundKind ?? ("admin" as const),
            amountCents: allocation.amountCents,
          },
        ],
      }));
  if (!annualFunds && schedule.feeKind !== "special") {
    throw new DomainError("INVALID_LEVY_SCHEDULE", "Levy schedule has no adopted budget", 422);
  }

  // Per-OC trust segregation (OC Act s 122): the scheme must have its OWN
  // collection account before any PayID is allocated — references register
  // under it, never a shared platform pool.
  const trustAccount = await ensureSchemeTrustAccount(ctx, schemeId);
  const account = {
    providerAccountId: trustAccount.providerAccountId ?? "",
    bsb: trustAccount.bsb ?? "",
    accountNumber: trustAccount.accountNumber ?? "",
    payidRoot: trustAccount.payidRoot,
  };

  const dueOn = addMonthsDateOnly(
    schedule.firstDueOn,
    (instalment - 1) * MONTHS_BETWEEN[schedule.frequency],
  );
  // s 31: the approved fee notice must give the owner at least 28 days.
  const minimumDueOn = toDateOnly(addDays(ctx.clock.now(), 28));
  if (dueOn < minimumDueOn) {
    throw new DomainError(
      "FEE_NOTICE_28_DAY_FLOOR",
      `Fee notices must allow at least 28 days (due date must be ${minimumDueOn} or later)`,
      422,
    );
  }
  const interestAuthority = await activeInterestAuthorisation(
    ctx,
    schemeId,
    toDateOnly(ctx.clock.now()),
  );
  const year = dueOn.slice(0, 4);

  const issued: {
    levyNoticeId: string;
    noticeNumber: string;
    lotId: string;
    totalCents: number;
    payid: string | null;
    lines: { fundKind: string; description: string; amountCents: number }[];
    recipientEmail: string | null;
    recipientName: string | null;
    recipientPersonId: string | null;
  }[] = [];

  // Allocate every PayID BEFORE opening the transaction. createPaymentReference
  // is a live provider (Monoova) HTTP call; running it per-lot inside the tx would
  // hold one DB transaction open across seconds of sequential network I/O (idle-
  // in-transaction/statement timeouts, pool starvation) and, on a rollback/retry,
  // orphan already-registered PayIDs with no ledger record. Here the external
  // state is settled first; the tx below is pure DB work.
  //
  // GRACEFUL DEGRADATION: a provider PayID failure (e.g. Monoova registration
  // blocked upstream) must not stop the levy run — the notice issues with
  // payid=null and the notice/email fall back to bank-transfer instructions
  // (BSB/account + the notice number as reference); the treasurer records the
  // money via the manual rail through the identical allocation/receipt chain.
  const prepared = await Promise.all(
    run.map(async (entry) => {
      const lot = lotRows.find((l) => l.id === entry.lotId)!;
      const prefix = schedule.feeKind === "special" ? `SF-${schedule.id.slice(0, 8)}` : "LN";
      const noticeNumber = `${prefix}-${year}-${String(instalment).padStart(2, "0")}-${lot.lotNumber}`;
      let payid: string | null = null;
      try {
        payid = await ctx.integrations.payments.createPaymentReference({
          schemeId,
          noticeNumber,
          account,
        });
      } catch (err) {
        console.error(
          `[levies] PayID registration failed for ${noticeNumber} — issuing with manual payment instructions`,
          err,
        );
      }
      return { entry, noticeNumber, payid };
    }),
  );

  await ctx.db.transaction(async (tx) => {
    // The instalment period opens once per run, ahead of the per-lot notices.
    await publishEvent(tx, {
      schemeId,
      stream: `levy_schedule:${scheduleId}`,
      type: "levy.period.opened",
      payload: {
        levyScheduleId: scheduleId,
        budgetId: schedule.budgetId,
        instalment,
        dueOn,
        noticeCount: prepared.length,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    for (const { entry, noticeNumber, payid } of prepared) {
      const noticeRows = await tx
        .insert(levyNotices)
        .values({
          schemeId,
          lotId: entry.lotId,
          levyScheduleId: scheduleId,
          instalment,
          noticeNumber,
          issuedAt: ctx.clock.now(),
          dueOn,
          totalCents: entry.totalCents,
          status: "issued",
          payid,
          interestRateBps: interestAuthority?.rateBps ?? 0,
          interestMotionId: interestAuthority?.motionId ?? null,
        })
        .returning();
      const notice = noticeRows[0]!;

      const lineRows = entry.lines.map((line) => ({
        levyNoticeId: notice.id,
        fundKind: line.fundKind,
        description:
          schedule.feeKind === "special"
            ? (schedule.description ?? "Special fee")
            : `${line.fundKind === "admin" ? "Administration" : "Maintenance"} fund levy`,
        amountCents: line.amountCents,
      }));
      await tx.insert(levyNoticeLines).values(lineRows);

      // The charge hits the lot ledger the moment the notice issues.
      await tx.insert(lotLedgerEntries).values({
        schemeId,
        lotId: entry.lotId,
        kind: "levy_charge",
        amountCents: entry.totalCents,
        levyNoticeId: notice.id,
        effectiveOn: toDateOnly(ctx.clock.now()),
      });

      await publishEvent(tx, {
        schemeId,
        stream: `levy_notice:${notice.id}`,
        type: "levy.notice.issued",
        payload: {
          levyNoticeId: notice.id,
          lotId: entry.lotId,
          noticeNumber,
          totalCents: entry.totalCents,
          dueOn,
          payid,
        },
        actor: ctx.actor,
        ...causationFields(ctx),
      });

      const recipient = await levyRecipientForLot(ctx, tx, schemeId, entry.lotId);
      issued.push({
        levyNoticeId: notice.id,
        noticeNumber,
        lotId: entry.lotId,
        totalCents: entry.totalCents,
        payid,
        lines: lineRows.map((l) => ({
          fundKind: l.fundKind,
          description: l.description,
          amountCents: l.amountCents,
        })),
        recipientEmail: recipient?.email ?? null,
        recipientName: recipient?.name ?? null,
        recipientPersonId: recipient?.personId ?? null,
      });
    }
  });

  // Persist each notice as a stored PDF (audit copy) after commit — the notice
  // and its ledger charge exist regardless of PDF fate; the on-demand PDF
  // route still renders live. Stored at accessLevel "admin": a levy notice is
  // one lot's personal financial record, and "owners" would expose it to EVERY
  // owner in the scheme (s146 access tiers).
  for (const notice of issued) {
    try {
      const lot = lotRows.find((l) => l.id === notice.lotId)!;
      const pdf = await buildLevyNoticePdf({
        scheme: schemeParty(scheme),
        billTo: {
          name: notice.recipientName ?? "Lot owner",
          email: notice.recipientEmail,
        },
        lot: {
          lotNumber: lot.lotNumber,
          unitNumber: lot.unitNumber,
          streetAddress: lot.streetAddress,
        },
        notice: {
          noticeNumber: notice.noticeNumber,
          issuedAt: ctx.clock.now(),
          dueOn,
          instalment,
          totalCents: notice.totalCents,
        },
        lines: notice.lines,
        payment: {
          reference: notice.payid,
          bsb: account.bsb || null,
          accountNumber: account.accountNumber || null,
          payid: account.payidRoot,
          accountName: scheme.name,
        },
        interestRateBps: interestAuthority?.rateBps ?? 0,
        interestAuthorised: Boolean(interestAuthority && interestAuthority.rateBps > 0),
        disputeProcess:
          "The owners corporation's internal dispute resolution process applies to disputes about these fees and charges. Contact the secretary or manager to lodge a written complaint.",
      });
      const doc = await uploadDocument(ctx, schemeId, {
        filename: `Levy-Notice-${notice.noticeNumber}.pdf`,
        contentType: "application/pdf",
        content: new Uint8Array(pdf),
        category: "levy_notice",
        accessLevel: "admin",
        title: `Levy notice ${notice.noticeNumber}`,
      });
      await ctx.db
        .update(levyNotices)
        .set({ documentId: doc.id })
        .where(eq(levyNotices.id, notice.levyNoticeId));
    } catch (err) {
      console.error(`[levies] failed to persist PDF for ${notice.noticeNumber}`, err);
    }
  }

  // Emails after commit — the notice exists regardless of email fate.
  const financeUrl = `${emailBrand.urls.app}/schemes/${schemeId}?section=finance`;
  for (const notice of issued) {
    if (!notice.recipientEmail) continue;
    const lot = lotRows.find((l) => l.id === notice.lotId)!;
    const amountDue = formatCents(notice.totalCents);
    const detailRows = [
      { label: "Notice number", value: notice.noticeNumber },
      { label: "Lot", value: lot.lotNumber },
      { label: "Due date", value: dueOn },
    ];
    if (notice.payid) {
      detailRows.push({ label: "Pay by (PayID)", value: notice.payid });
    } else if (account.bsb && account.accountNumber) {
      detailRows.push({ label: "Pay by bank transfer", value: `BSB ${account.bsb}` });
      detailRows.push({ label: "Account number", value: account.accountNumber });
    }
    detailRows.push({ label: "Payment reference", value: notice.noticeNumber });

    const howToPay = notice.payid
      ? `To pay, use PayID ${notice.payid} and quote reference ${notice.noticeNumber}. Your payment is matched to this lot automatically.`
      : account.bsb && account.accountNumber
        ? `To pay, transfer to BSB ${account.bsb}, account ${account.accountNumber}, and quote reference ${notice.noticeNumber} so your payment is matched to this lot.`
        : `To pay, use the payment details shown in the portal and quote reference ${notice.noticeNumber}.`;

    const { html, text } = renderEmail({
      preheader: `${amountDue} due ${dueOn} for lot ${lot.lotNumber} at ${scheme.name}.`,
      heading: `Levy notice ${notice.noticeNumber}`,
      intro: `Dear ${notice.recipientName ?? "Owner"}, a levy notice has been issued for lot ${lot.lotNumber} at ${scheme.name}.`,
      blocks: [
        amountPanel("Amount due", amountDue, { sublabel: `Due ${dueOn}` }),
        keyValueTable(detailRows, "Notice details"),
        paragraph(howToPay),
        infoNote(
          interestAuthority?.rateBps
            ? `Payment is due within 28 days. The owners corporation has resolved that penalty interest at ${interestAuthority.rateBps / 100}% p.a. applies after the due date. Its internal dispute process applies to fee disputes; contact the secretary or manager. If you are experiencing hardship, ask about a payment plan.`
            : "Payment is due within 28 days. The owners corporation's internal dispute process applies to fee disputes; contact the secretary or manager. If you are experiencing hardship, ask about a payment plan.",
        ),
      ],
      cta: { label: "View & pay", url: financeUrl },
    });

    await sendEmail(ctx, {
      schemeId,
      personId: notice.recipientPersonId ?? undefined,
      to: notice.recipientEmail,
      subject: `Levy notice ${notice.noticeNumber} — ${scheme.name}`,
      template: "levy_notice",
      related: { type: "levy_notice", id: notice.levyNoticeId },
      body: text,
      html,
    });
  }

  return { issued: issued.length, dueOn, notices: issued };
}

/** The person flagged as levy recipient for a lot (falls back to any owner). */
async function levyRecipientForLot(
  _ctx: ServiceContext,
  tx: DbHandle,
  schemeId: string,
  lotId: string,
): Promise<{ personId: string; email: string | null; name: string | null } | null> {
  const rows = await tx
    .select({
      personId: people.id,
      email: people.email,
      givenName: people.givenName,
      familyName: people.familyName,
      isLevyRecipient: ownerships.isLevyRecipient,
    })
    .from(ownerships)
    .innerJoin(people, eq(ownerships.personId, people.id))
    .where(
      and(
        eq(ownerships.schemeId, schemeId),
        eq(ownerships.lotId, lotId),
        isNull(ownerships.endedOn),
      ),
    );
  if (rows.length === 0) return null;
  const preferred = rows.find((r) => r.isLevyRecipient) ?? rows[0]!;
  return {
    personId: preferred.personId,
    email: preferred.email,
    name: `${preferred.givenName ?? ""} ${preferred.familyName ?? ""}`.trim() || null,
  };
}

/** Map a scheme row onto the PDF renderer's issuer party. */
function schemeParty(scheme: typeof schemes.$inferSelect): LevyNoticeDoc["scheme"] {
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

export async function listNotices(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.levyNotices.findMany({
    where: eq(levyNotices.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

export const writeOffNoticeInput = z.object({
  /** Why the debt is uncollectible — goes on the ledger and the event log. */
  reason: z.string().trim().min(1).max(500),
});
export type WriteOffNoticeInput = z.infer<typeof writeOffNoticeInput>;

export interface WriteOffResult {
  levyNoticeId: string;
  /** Unpaid levy principal cleared by the balancing adjustment. */
  writtenOffCents: number;
  /** Stranded penalty interest cleared alongside (0 when none). */
  interestWrittenOffCents: number;
  /** True when the notice was already written off — the call was a no-op. */
  alreadyWrittenOff: boolean;
}

/**
 * Write off an uncollectible levy notice: transition it to `written_off`,
 * post a balancing lot-ledger adjustment for the unpaid remainder, and — when
 * the lot has no other open notices — clear any stranded penalty interest so
 * the lot account squares to zero instead of carrying an uncollectible tail.
 * Idempotent: a repeat call on a written-off notice is a no-op; the
 * compare-and-set status flip serializes concurrent write-offs.
 */
export async function writeOffLevyNotice(
  ctx: ServiceContext,
  schemeId: string,
  noticeId: string,
  reason: string,
): Promise<WriteOffResult> {
  const notice = await ctx.db.query.levyNotices.findFirst({
    where: and(eq(levyNotices.id, noticeId), eq(levyNotices.schemeId, schemeId)),
  });
  if (!notice) throw notFound("Levy notice");

  const today = toDateOnly(ctx.clock.now());

  return await ctx.db.transaction(async (tx) => {
    // Compare-and-set: only an OPEN notice flips. Concurrent write-offs (or a
    // racing payment application) serialize on the row lock — the loser sees
    // 0 rows and never double-posts the adjustment.
    const flipped = await tx
      .update(levyNotices)
      .set({ status: "written_off" })
      .where(
        and(
          eq(levyNotices.id, notice.id),
          inArray(levyNotices.status, ["issued", "partially_paid", "overdue"]),
        ),
      )
      .returning({ id: levyNotices.id });
    if (flipped.length === 0) {
      const current = await tx.query.levyNotices.findFirst({
        where: eq(levyNotices.id, notice.id),
      });
      if (current?.status === "written_off") {
        return {
          levyNoticeId: notice.id,
          writtenOffCents: 0,
          interestWrittenOffCents: 0,
          alreadyWrittenOff: true,
        };
      }
      throw new DomainError(
        "NOTICE_NOT_OPEN",
        `Notice ${notice.noticeNumber} is ${current?.status ?? "unknown"} — only an open notice can be written off`,
        422,
      );
    }

    const allocations = await tx.query.paymentAllocations.findMany({
      where: eq(paymentAllocations.levyNoticeId, notice.id),
    });
    const allocated = allocations.reduce((a, r) => a + r.amountCents, 0);
    const outstanding = Math.max(0, notice.totalCents - allocated);

    if (outstanding > 0) {
      await tx.insert(lotLedgerEntries).values({
        schemeId,
        lotId: notice.lotId,
        kind: "adjustment",
        amountCents: -outstanding,
        levyNoticeId: notice.id,
        note: `Levy notice ${notice.noticeNumber} written off: ${reason}`,
        effectiveOn: today,
      });
    }

    // If this was the lot's last open notice, any remaining positive balance
    // is penalty interest accrued on the debt just written off — equally
    // uncollectible, so clear it rather than stranding it on the account.
    let interestWrittenOff = 0;
    const otherOpen = await tx.query.levyNotices.findFirst({
      where: and(
        eq(levyNotices.schemeId, schemeId),
        eq(levyNotices.lotId, notice.lotId),
        inArray(levyNotices.status, ["issued", "partially_paid", "overdue"]),
      ),
    });
    if (!otherOpen) {
      const balanceRows = await tx
        .select({ balance: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)` })
        .from(lotLedgerEntries)
        .where(
          and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, notice.lotId)),
        );
      const remaining = Number(balanceRows[0]?.balance ?? 0);
      if (remaining > 0) {
        interestWrittenOff = remaining;
        await tx.insert(lotLedgerEntries).values({
          schemeId,
          lotId: notice.lotId,
          kind: "adjustment",
          amountCents: -remaining,
          levyNoticeId: notice.id,
          note: `Accrued penalty interest written off with notice ${notice.noticeNumber}: ${reason}`,
          effectiveOn: today,
        });
      }
    }

    await publishEvent(tx, {
      schemeId,
      stream: `levy_notice:${notice.id}`,
      type: "levy.notice.written_off",
      payload: {
        levyNoticeId: notice.id,
        lotId: notice.lotId,
        noticeNumber: notice.noticeNumber,
        writtenOffCents: outstanding,
        interestWrittenOffCents: interestWrittenOff,
        reason,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return {
      levyNoticeId: notice.id,
      writtenOffCents: outstanding,
      interestWrittenOffCents: interestWrittenOff,
      alreadyWrittenOff: false,
    };
  });
}
