import { type DbHandle, lots, ownerships, people } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { isRealDateOnly, OWNERSHIP_KINDS, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

/**
 * The ownership register. Ownership rows are never deleted: a transfer closes
 * the outgoing period (endedOn) and opens a new row, so the register keeps
 * its history the same way memberships do. Entitlement and liability live on
 * the LOT — nothing here touches levy amounts or money maths.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(isRealDateOnly, "Enter a real calendar date");

export const addOwnerInput = z
  .object({
    personId: z.uuid(),
    kind: z.enum(OWNERSHIP_KINDS).default("sole"),
    shareNumerator: z.number().int().min(1).max(1_000_000).default(1),
    shareDenominator: z.number().int().min(1).max(1_000_000).default(1),
    /** Omitted: becomes the recipient only when the lot has none. */
    isLevyRecipient: z.boolean().optional(),
    /** Omitted: today. */
    startedOn: dateOnly.optional(),
  })
  .refine((v) => v.shareNumerator <= v.shareDenominator, {
    message: "A share can't exceed the whole lot",
    path: ["shareNumerator"],
  });
export type AddOwnerInput = z.infer<typeof addOwnerInput>;

export const endOwnershipInput = z.object({
  /** Omitted: today. */
  endedOn: dateOnly.optional(),
});
export type EndOwnershipInput = z.infer<typeof endOwnershipInput>;

export const updateOwnershipInput = z
  .object({
    kind: z.enum(OWNERSHIP_KINDS).optional(),
    shareNumerator: z.number().int().min(1).max(1_000_000).optional(),
    shareDenominator: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict()
  .refine((v) => (v.shareNumerator === undefined) === (v.shareDenominator === undefined), {
    message: "Provide the share as a numerator and denominator together",
    path: ["shareNumerator"],
  })
  .refine(
    (v) =>
      v.shareNumerator === undefined ||
      v.shareDenominator === undefined ||
      v.shareNumerator <= v.shareDenominator,
    { message: "A share can't exceed the whole lot", path: ["shareNumerator"] },
  );
export type UpdateOwnershipInput = z.infer<typeof updateOwnershipInput>;

interface Share {
  shareNumerator: number;
  shareDenominator: number;
}

/**
 * Fractional interests (numerator < denominator, tenants-in-common style) must
 * not oversubscribe the lot. Whole 1/1 rows are joint proprietors of the
 * entire lot and sit outside the fraction sum — otherwise adding any co-owner
 * to a lot imported with a default 1/1 owner would be impossible.
 */
function assertSharesFit(shares: Share[]): void {
  const fractional = shares.filter((s) => s.shareNumerator < s.shareDenominator);
  // Exact integer arithmetic over a running common denominator; BigInt because
  // the denominator product can overflow a double well within input bounds.
  let num = 0n;
  let den = 1n;
  for (const s of fractional) {
    num = num * BigInt(s.shareDenominator) + BigInt(s.shareNumerator) * den;
    den = den * BigInt(s.shareDenominator);
  }
  if (num > den) {
    throw new DomainError(
      "SHARES_EXCEED_WHOLE",
      "The lot's ownership shares would add up to more than the whole lot",
      422,
    );
  }
}

async function requireLotInScheme(tx: DbHandle, schemeId: string, lotId: string): Promise<void> {
  const lot = await tx.query.lots.findFirst({
    where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)),
    columns: { id: true },
  });
  if (!lot) throw notFound("Lot");
}

/**
 * Record a new current owner on a lot: the incoming side of a transfer, or a
 * co-owner joining the register. The person must already be on this scheme's
 * roll and not already hold a current ownership of the lot.
 */
export async function addOwner(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  input: AddOwnerInput,
) {
  return await ctx.db.transaction(async (tx) => {
    await requireLotInScheme(tx, schemeId, lotId);
    // Scheme-scoped person lookup: a person from another scheme 404s the same
    // as a person that doesn't exist, so rolls never leak across schemes.
    const person = await tx.query.people.findFirst({
      where: and(eq(people.id, input.personId), eq(people.schemeId, schemeId)),
      columns: { id: true },
    });
    if (!person) throw notFound("Person");

    const current = await tx.query.ownerships.findMany({
      where: and(eq(ownerships.lotId, lotId), isNull(ownerships.endedOn)),
    });
    if (current.some((o) => o.personId === input.personId)) {
      throw new DomainError(
        "ALREADY_OWNER",
        "That person already holds a current ownership of this lot",
        409,
      );
    }
    assertSharesFit([...current, input]);

    // At most one levy recipient per lot: taking the flag demotes the holder.
    const holder = current.find((o) => o.isLevyRecipient);
    const isLevyRecipient = input.isLevyRecipient ?? !holder;
    if (isLevyRecipient && holder) {
      await tx
        .update(ownerships)
        .set({ isLevyRecipient: false })
        .where(eq(ownerships.id, holder.id));
    }

    const startedOn = input.startedOn ?? toDateOnly(ctx.clock.now());
    const rows = await tx
      .insert(ownerships)
      .values({
        schemeId,
        lotId,
        personId: input.personId,
        kind: input.kind,
        shareNumerator: input.shareNumerator,
        shareDenominator: input.shareDenominator,
        isLevyRecipient,
        startedOn,
      })
      .returning();
    const ownership = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "ownership.started",
      payload: {
        ownershipId: ownership.id,
        lotId,
        personId: ownership.personId,
        kind: ownership.kind,
        shareNumerator: ownership.shareNumerator,
        shareDenominator: ownership.shareDenominator,
        isLevyRecipient: ownership.isLevyRecipient,
        startedOn: ownership.startedOn,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return ownership;
  });
}

/**
 * Close an ownership period (the outgoing side of a transfer). The row is
 * end-dated, never deleted — the register keeps its history. If the outgoing
 * owner was the levy recipient, the longest-standing remaining owner inherits
 * the flag so levy notices always have somewhere to go.
 */
export async function endOwnership(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  ownershipId: string,
  input: EndOwnershipInput = {},
) {
  return await ctx.db.transaction(async (tx) => {
    const ownership = await tx.query.ownerships.findFirst({
      where: and(
        eq(ownerships.id, ownershipId),
        eq(ownerships.schemeId, schemeId),
        eq(ownerships.lotId, lotId),
        isNull(ownerships.endedOn),
      ),
    });
    if (!ownership) throw notFound("Ownership");

    const endedOn = input.endedOn ?? toDateOnly(ctx.clock.now());
    if (endedOn < ownership.startedOn) {
      throw new DomainError(
        "ENDS_BEFORE_START",
        `The ownership started on ${ownership.startedOn} — it can't end before that`,
        422,
      );
    }
    // Clear the levy flag as the period closes. Every read already filters on
    // endedOn, so a stale `isLevyRecipient` on a closed row is harmless today —
    // but it leaves two rows on the lot claiming to be the recipient, and the
    // next person to write a query without the endedOn filter inherits a
    // silent billing bug. The register should not hold a claim that is no
    // longer true.
    const rows = await tx
      .update(ownerships)
      .set({ endedOn, isLevyRecipient: false })
      .where(eq(ownerships.id, ownershipId))
      .returning();

    let promotedLevyRecipientOwnershipId: string | null = null;
    if (ownership.isLevyRecipient) {
      const remaining = await tx.query.ownerships.findMany({
        where: and(eq(ownerships.lotId, lotId), isNull(ownerships.endedOn)),
      });
      const next = [...remaining].sort(
        (a, b) =>
          a.startedOn.localeCompare(b.startedOn) || a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];
      if (next) {
        await tx
          .update(ownerships)
          .set({ isLevyRecipient: true })
          .where(eq(ownerships.id, next.id));
        promotedLevyRecipientOwnershipId = next.id;
      }
    }

    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "ownership.ended",
      payload: {
        ownershipId,
        lotId,
        personId: ownership.personId,
        endedOn,
        promotedLevyRecipientOwnershipId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
}

/**
 * Move the lot's levy-notice recipient to a different current owner. The flag
 * swaps atomically so the lot never has two recipients; setting it on the
 * current holder is a no-op.
 */
export async function setLevyRecipient(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  ownershipId: string,
) {
  return await ctx.db.transaction(async (tx) => {
    const target = await tx.query.ownerships.findFirst({
      where: and(
        eq(ownerships.id, ownershipId),
        eq(ownerships.schemeId, schemeId),
        eq(ownerships.lotId, lotId),
        isNull(ownerships.endedOn),
      ),
    });
    if (!target) throw notFound("Ownership");
    if (target.isLevyRecipient) return target;

    const previous = await tx.query.ownerships.findFirst({
      where: and(
        eq(ownerships.lotId, lotId),
        isNull(ownerships.endedOn),
        eq(ownerships.isLevyRecipient, true),
      ),
      columns: { id: true },
    });
    if (previous) {
      await tx
        .update(ownerships)
        .set({ isLevyRecipient: false })
        .where(eq(ownerships.id, previous.id));
    }
    const rows = await tx
      .update(ownerships)
      .set({ isLevyRecipient: true })
      .where(eq(ownerships.id, ownershipId))
      .returning();

    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "lot.levy_recipient.changed",
      payload: {
        lotId,
        ownershipId,
        personId: target.personId,
        previousOwnershipId: previous?.id ?? null,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
}

/**
 * Correct a current ownership's kind or share in place. This is for fixing a
 * mis-recorded holding — an actual change of hands is a transfer (end-date +
 * new row) so the period history stays truthful.
 */
export async function updateOwnership(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  ownershipId: string,
  input: UpdateOwnershipInput,
) {
  return await ctx.db.transaction(async (tx) => {
    const target = await tx.query.ownerships.findFirst({
      where: and(
        eq(ownerships.id, ownershipId),
        eq(ownerships.schemeId, schemeId),
        eq(ownerships.lotId, lotId),
        isNull(ownerships.endedOn),
      ),
    });
    if (!target) throw notFound("Ownership");

    if (input.shareNumerator !== undefined && input.shareDenominator !== undefined) {
      const others = await tx.query.ownerships.findMany({
        where: and(eq(ownerships.lotId, lotId), isNull(ownerships.endedOn)),
      });
      assertSharesFit([
        ...others.filter((o) => o.id !== ownershipId),
        { shareNumerator: input.shareNumerator, shareDenominator: input.shareDenominator },
      ]);
    }

    const rows = await tx
      .update(ownerships)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.shareNumerator !== undefined && input.shareDenominator !== undefined
          ? { shareNumerator: input.shareNumerator, shareDenominator: input.shareDenominator }
          : {}),
      })
      .where(eq(ownerships.id, ownershipId))
      .returning();
    const updated = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `lot:${lotId}`,
      type: "ownership.updated",
      payload: {
        ownershipId,
        lotId,
        personId: updated.personId,
        kind: updated.kind,
        shareNumerator: updated.shareNumerator,
        shareDenominator: updated.shareDenominator,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return updated;
  });
}
