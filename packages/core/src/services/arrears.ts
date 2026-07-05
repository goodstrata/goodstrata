import {
  eventLog,
  levyNotices,
  lotLedgerEntries,
  lots,
  ownerships,
  people,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { daysBetween, fromDateOnly, toDateOnly } from "@goodstrata/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { arrearsStage, stageKind } from "../engines/arrears-ladder.js";
import { interestAccrued } from "../engines/interest.js";

export interface LotArrears {
  lotId: string;
  lotNumber: string;
  outstandingCents: number;
  daysOverdue: number;
  stage: number;
  interestAccruedCents: number;
  earliestDueOn: string;
}

/** Current arrears picture for a scheme (pure read). */
export async function arrearsForScheme(
  ctx: ServiceContext,
  schemeId: string,
): Promise<LotArrears[]> {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) return [];
  const settings = scheme.settings;

  const overdue = await ctx.db
    .select({
      lotId: levyNotices.lotId,
      lotNumber: lots.lotNumber,
      dueOn: levyNotices.dueOn,
      totalCents: levyNotices.totalCents,
      noticeId: levyNotices.id,
    })
    .from(levyNotices)
    .innerJoin(lots, eq(levyNotices.lotId, lots.id))
    .where(
      and(
        eq(levyNotices.schemeId, schemeId),
        inArray(levyNotices.status, ["issued", "partially_paid", "overdue"]),
      ),
    );

  const now = ctx.clock.now();
  const byLot = new Map<string, { lotNumber: string; earliestDueOn: string }>();
  for (const row of overdue) {
    if (fromDateOnly(row.dueOn) >= now) continue; // not yet due
    const existing = byLot.get(row.lotId);
    if (!existing || row.dueOn < existing.earliestDueOn) {
      byLot.set(row.lotId, { lotNumber: row.lotNumber, earliestDueOn: row.dueOn });
    }
  }

  const results: LotArrears[] = [];
  for (const [lotId, info] of byLot) {
    const balanceRows = await ctx.db
      .select({ balance: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)` })
      .from(lotLedgerEntries)
      .where(and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotId)));
    const outstandingCents = Number(balanceRows[0]?.balance ?? 0);
    if (outstandingCents <= 0) continue;

    const daysOverdue = daysBetween(fromDateOnly(info.earliestDueOn), now);
    if (daysOverdue <= 0) continue;

    results.push({
      lotId,
      lotNumber: info.lotNumber,
      outstandingCents,
      daysOverdue,
      stage: arrearsStage(daysOverdue),
      interestAccruedCents: interestAccrued(
        outstandingCents,
        settings.penaltyInterestBps,
        daysOverdue,
        settings.interestGraceDays,
      ),
      earliestDueOn: info.earliestDueOn,
    });
  }
  return results;
}

/**
 * The daily arrears sweep (pure code — cron never calls an LLM). Emits an
 * `arrears.stage.reached` event exactly once per lot per stage; the finance
 * agent reacts to those events with drafted reminders or a decision gate.
 */
export async function scanArrears(ctx: ServiceContext, schemeId: string) {
  const arrears = await arrearsForScheme(ctx, schemeId);
  const emitted: { lotId: string; stage: number }[] = [];

  for (const lot of arrears) {
    if (lot.stage === 0) continue;

    // Event-sourced dedupe: what stage have we already announced for this lot
    // since it last had a clean slate?
    const lastEvent = await ctx.db.query.eventLog.findFirst({
      where: and(
        eq(eventLog.schemeId, schemeId),
        eq(eventLog.stream, `lot:${lot.lotId}`),
        eq(eventLog.type, "arrears.stage.reached"),
      ),
      orderBy: desc(eventLog.seq),
    });
    const lastStage = lastEvent
      ? (lastEvent.payload as { stage: number; earliestDueOn?: string }).stage
      : 0;
    const lastDue = lastEvent
      ? (lastEvent.payload as { earliestDueOn?: string }).earliestDueOn
      : undefined;
    // New arrears episode (older episode cleared) → ladder restarts.
    const effectiveLast = lastDue === lot.earliestDueOn ? lastStage : 0;
    if (lot.stage <= effectiveLast) continue;

    const published = await ctx.db.transaction(async (tx) => {
      await tx
        .update(levyNotices)
        .set({ status: "overdue" })
        .where(
          and(
            eq(levyNotices.schemeId, schemeId),
            eq(levyNotices.lotId, lot.lotId),
            inArray(levyNotices.status, ["issued", "partially_paid"]),
            sql`${levyNotices.dueOn} < ${toDateOnly(ctx.clock.now())}`,
          ),
        );

      return await publishEvent(tx, {
        schemeId,
        stream: `lot:${lot.lotId}`,
        type: "arrears.stage.reached",
        payload: {
          lotId: lot.lotId,
          stage: lot.stage,
          kind: stageKind(lot.stage) ?? "unknown",
          daysOverdue: lot.daysOverdue,
          outstandingCents: lot.outstandingCents,
          interestAccruedCents: lot.interestAccruedCents,
          earliestDueOn: lot.earliestDueOn,
        },
        actor: ctx.actor,
        // The eventLog read above is only advisory — two overlapping sweeps
        // (cron overlap, manual trigger) can both see the same lastStage. The
        // unique dedupeKey makes "once per lot per stage per episode" a DB
        // guarantee: the second publish is a no-op.
        dedupeKey: `arrears:${lot.lotId}:${lot.earliestDueOn}:stage${lot.stage}`,
        ...causationFields(ctx),
      });
    });
    if (!published.deduped) emitted.push({ lotId: lot.lotId, stage: lot.stage });
  }

  return { scanned: arrears.length, emitted };
}

/** Levy recipient (name/email) for a lot — used by reminder/receipt emails. */
export async function levyRecipient(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
): Promise<{ personId: string; email: string | null; name: string | null } | null> {
  const rows = await ctx.db
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

/** Statement lines for a lot (drives the UI and agent context). */
export async function lotStatement(ctx: ServiceContext, schemeId: string, lotId: string) {
  const entries = await ctx.db.query.lotLedgerEntries.findMany({
    where: and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotId)),
    orderBy: (t, { asc }) => [asc(t.effectiveOn), asc(t.createdAt)],
  });
  const balance = entries.reduce((a, e) => a + e.amountCents, 0);
  return { entries, balanceCents: balance };
}
