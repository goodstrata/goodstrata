import {
  type DbHandle,
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
import { activeInterestAuthorisation } from "./interestAuthorisations.js";

export interface LotArrears {
  lotId: string;
  lotNumber: string;
  /** Levy/adjustment balance owing, EXCLUDING posted penalty interest. */
  outstandingCents: number;
  daysOverdue: number;
  stage: number;
  /**
   * Unpaid penalty interest POSTED to the lot ledger (kind "interest"). Every
   * figure here is ledger-derived, so outstanding + interest always equals the
   * lot's statement balance — an owner who pays the quoted total is square.
   */
  interestAccruedCents: number;
  earliestDueOn: string;
}

/** Current arrears picture for a scheme (pure read, ledger-derived). */
export async function arrearsForScheme(
  ctx: ServiceContext,
  schemeId: string,
): Promise<LotArrears[]> {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) return [];

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
    const { balanceCents, postedInterestCents } = await lotLedgerTotals(ctx.db, schemeId, lotId);
    if (balanceCents <= 0) continue;

    const daysOverdue = daysBetween(fromDateOnly(info.earliestDueOn), now);
    if (daysOverdue <= 0) continue;

    // Split the ledger balance into levy principal vs unpaid posted interest,
    // treating payments as settling principal first (never over-attributes to
    // interest). The two figures always sum back to the statement balance.
    const outstandingCents = Math.max(0, balanceCents - postedInterestCents);
    const interestOwedCents = balanceCents - outstandingCents;

    results.push({
      lotId,
      lotNumber: info.lotNumber,
      outstandingCents,
      daysOverdue,
      stage: arrearsStage(daysOverdue),
      interestAccruedCents: interestOwedCents,
      earliestDueOn: info.earliestDueOn,
    });
  }
  return results;
}

/** Ledger balance + gross posted penalty interest for one lot. */
async function lotLedgerTotals(
  db: ServiceContext["db"] | DbHandle,
  schemeId: string,
  lotId: string,
): Promise<{ balanceCents: number; postedInterestCents: number }> {
  const rows = await db
    .select({
      balance: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)`,
      interest: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}) filter (where ${lotLedgerEntries.kind} = 'interest'), 0)`,
    })
    .from(lotLedgerEntries)
    .where(and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotId)));
  return {
    balanceCents: Number(rows[0]?.balance ?? 0),
    postedInterestCents: Number(rows[0]?.interest ?? 0),
  };
}

/**
 * The daily arrears sweep (pure code — cron never calls an LLM). For every lot
 * in arrears it: flips past-due notices to `overdue` (publishing
 * `levy.notice.overdue` once per notice), POSTS accrued penalty interest to
 * the lot ledger (kind "interest", once per lot per day — the dedupeKey makes
 * re-runs a no-op), and emits an `arrears.stage.reached` event exactly once
 * per lot per stage; the finance agent reacts to those events with drafted
 * reminders or a decision gate. Because interest posts BEFORE the stage event,
 * the amounts the event (and the emails built from it) quotes are exactly the
 * lot's ledger balance — an owner who pays the quoted total is square.
 */
export async function scanArrears(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) return { scanned: 0, emitted: [], interestPosted: [] };
  const settings = scheme.settings;

  const arrears = await arrearsForScheme(ctx, schemeId);
  const emitted: { lotId: string; stage: number }[] = [];
  const interestPosted: { lotId: string; amountCents: number }[] = [];
  const today = toDateOnly(ctx.clock.now());
  // s 29: penalty interest is opt-in by OC resolution. A configured default
  // rate alone is never authority to charge it.
  const interestAuthority = await activeInterestAuthorisation(ctx, schemeId, today);
  const interestSettings = {
    penaltyInterestBps: interestAuthority?.rateBps ?? 0,
    interestGraceDays: settings.interestGraceDays,
  };

  for (const lot of arrears) {
    // 1. Flip past-due notices + accrue interest, committed together per lot.
    const posted = await ctx.db.transaction(async (tx) => {
      const flipped = await tx
        .update(levyNotices)
        .set({ status: "overdue" })
        .where(
          and(
            eq(levyNotices.schemeId, schemeId),
            eq(levyNotices.lotId, lot.lotId),
            inArray(levyNotices.status, ["issued", "partially_paid"]),
            sql`${levyNotices.dueOn} < ${today}`,
          ),
        )
        .returning({ id: levyNotices.id });
      // The status transition happens exactly once per notice (the update's
      // WHERE excludes already-overdue rows), so each notice gets one event.
      for (const notice of flipped) {
        await publishEvent(tx, {
          schemeId,
          stream: `levy_notice:${notice.id}`,
          type: "levy.notice.overdue",
          payload: { levyNoticeId: notice.id, lotId: lot.lotId },
          actor: ctx.actor,
          ...causationFields(ctx),
        });
      }

      return await accrueInterestForLot(ctx, tx, schemeId, interestSettings, lot, today);
    });
    if (posted > 0) interestPosted.push({ lotId: lot.lotId, amountCents: posted });

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
      return await publishEvent(tx, {
        schemeId,
        stream: `lot:${lot.lotId}`,
        type: "arrears.stage.reached",
        payload: {
          lotId: lot.lotId,
          stage: lot.stage,
          kind: stageKind(lot.stage) ?? "unknown",
          daysOverdue: lot.daysOverdue,
          // Ledger-derived, including the interest just posted above — the
          // quoted total (outstanding + interest) is the statement balance.
          outstandingCents: lot.outstandingCents,
          interestAccruedCents: lot.interestAccruedCents + posted,
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

  return { scanned: arrears.length, emitted, interestPosted };
}

/**
 * Post the penalty interest that has accrued but not yet been charged for a
 * lot's current arrears episode. The engine gives cumulative interest to date
 * on the outstanding levy principal (simple, non-compounding — interest never
 * accrues on interest); what lands on the ledger is the DELTA over what this
 * episode has already posted, so a daily sweep posts one increment per day and
 * a re-run posts nothing. Two overlapping sweeps serialize on the event's
 * unique dedupeKey (once per lot per day): the loser's publish dedupes and it
 * skips the ledger insert. Returns the cents posted (0 when up to date).
 */
async function accrueInterestForLot(
  ctx: ServiceContext,
  tx: DbHandle,
  schemeId: string,
  settings: { penaltyInterestBps: number; interestGraceDays: number },
  lot: Pick<LotArrears, "lotId" | "daysOverdue" | "earliestDueOn">,
  today: string,
): Promise<number> {
  // Re-read inside the transaction so the delta is computed against committed
  // state, and scope posted interest to the current episode (entries on/after
  // its earliest due date) so a past, settled episode never suppresses accrual.
  const totals = await tx
    .select({
      balance: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)`,
      episodeInterest: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}) filter (where ${lotLedgerEntries.kind} = 'interest' and ${lotLedgerEntries.effectiveOn} >= ${lot.earliestDueOn}), 0)`,
      grossInterest: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}) filter (where ${lotLedgerEntries.kind} = 'interest'), 0)`,
    })
    .from(lotLedgerEntries)
    .where(and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lot.lotId)));
  const balance = Number(totals[0]?.balance ?? 0);
  const episodeInterest = Number(totals[0]?.episodeInterest ?? 0);
  const grossInterest = Number(totals[0]?.grossInterest ?? 0);

  const principal = Math.max(0, balance - grossInterest);
  const accruedToDate = interestAccrued(
    principal,
    settings.penaltyInterestBps,
    lot.daysOverdue,
    settings.interestGraceDays,
  );
  const delta = accruedToDate - episodeInterest;
  if (delta <= 0) return 0;

  const published = await publishEvent(tx, {
    schemeId,
    stream: `lot:${lot.lotId}`,
    type: "arrears.interest.posted",
    payload: {
      lotId: lot.lotId,
      amountCents: delta,
      totalInterestPostedCents: episodeInterest + delta,
      daysOverdue: lot.daysOverdue,
      earliestDueOn: lot.earliestDueOn,
    },
    actor: ctx.actor,
    dedupeKey: `interest:${lot.lotId}:${today}`,
    ...causationFields(ctx),
  });
  if (published.deduped) return 0;

  await tx.insert(lotLedgerEntries).values({
    schemeId,
    lotId: lot.lotId,
    kind: "interest",
    amountCents: delta,
    note: `Penalty interest accrued to ${today} (${lot.daysOverdue} days overdue)`,
    effectiveOn: today,
  });
  return delta;
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
