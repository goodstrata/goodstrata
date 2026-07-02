import {
  type DbHandle,
  levyNoticeLines,
  levyNotices,
  levySchedules,
  lotLedgerEntries,
  lots,
  ownerships,
  people,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { addMonthsDateOnly, formatCents, type LevyFrequency, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { calculateLevyRun } from "../engines/levy-calc.js";
import { DomainError, notFound } from "../errors.js";
import { getAdoptedBudgetFunds } from "./budgets.js";
import { sendEmail } from "./comms.js";

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

  const funds = await getAdoptedBudgetFunds(ctx, schemeId, schedule.budgetId);
  const lotRows = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  if (lotRows.length === 0) throw new DomainError("NO_LOTS", "No lots to levy", 422);

  const existing = await ctx.db.query.levyNotices.findFirst({
    where: and(eq(levyNotices.levyScheduleId, scheduleId), eq(levyNotices.instalment, instalment)),
  });
  if (existing) {
    throw new DomainError("ALREADY_ISSUED", `Instalment ${instalment} is already issued`, 409);
  }

  const run = calculateLevyRun(
    funds,
    lotRows.map((l) => ({ lotId: l.id, liability: l.liability })),
    schedule.instalments,
  ).filter((r) => r.instalment === instalment);

  const dueOn = addMonthsDateOnly(
    schedule.firstDueOn,
    (instalment - 1) * MONTHS_BETWEEN[schedule.frequency],
  );
  const year = dueOn.slice(0, 4);

  const issued: {
    levyNoticeId: string;
    noticeNumber: string;
    lotId: string;
    totalCents: number;
    payid: string | null;
    recipientEmail: string | null;
    recipientName: string | null;
    recipientPersonId: string | null;
  }[] = [];

  await ctx.db.transaction(async (tx) => {
    for (const entry of run) {
      const lot = lotRows.find((l) => l.id === entry.lotId)!;
      const noticeNumber = `LN-${year}-${String(instalment).padStart(2, "0")}-${lot.lotNumber}`;
      const payid = await ctx.integrations.payments.createPaymentReference({
        schemeId,
        noticeNumber,
      });

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
        })
        .returning();
      const notice = noticeRows[0]!;

      await tx.insert(levyNoticeLines).values(
        entry.lines.map((line) => ({
          levyNoticeId: notice.id,
          fundKind: line.fundKind,
          description: `${line.fundKind === "admin" ? "Administration" : "Maintenance"} fund levy`,
          amountCents: line.amountCents,
        })),
      );

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
        recipientEmail: recipient?.email ?? null,
        recipientName: recipient?.name ?? null,
        recipientPersonId: recipient?.personId ?? null,
      });
    }
  });

  // Emails after commit — the notice exists regardless of email fate.
  for (const notice of issued) {
    if (!notice.recipientEmail) continue;
    const lot = lotRows.find((l) => l.id === notice.lotId)!;
    await sendEmail(ctx, {
      schemeId,
      personId: notice.recipientPersonId ?? undefined,
      to: notice.recipientEmail,
      subject: `Levy notice ${notice.noticeNumber} — ${scheme.name}`,
      template: "levy_notice",
      related: { type: "levy_notice", id: notice.levyNoticeId },
      body: [
        `Dear ${notice.recipientName ?? "Owner"},`,
        "",
        `A levy notice has been issued for lot ${lot.lotNumber} at ${scheme.name}.`,
        "",
        `Notice number: ${notice.noticeNumber}`,
        `Amount due: ${formatCents(notice.totalCents)}`,
        `Due date: ${dueOn}`,
        `Pay by reference (PayID): ${notice.payid}`,
        "",
        "Payment is due at least 28 days after this notice per the Owners Corporations Act 2006 (Vic).",
        "",
        "Regards,",
        `${scheme.name} — powered by GoodStrata`,
      ].join("\n"),
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

export async function listNotices(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.levyNotices.findMany({
    where: eq(levyNotices.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}
