import { invites, lots, memberships, ownerships, people, users } from "@goodstrata/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../context.js";
import { DomainError } from "../errors.js";

export const createPersonInput = z
  .object({
    givenName: z.string().trim().max(200).optional(),
    familyName: z.string().trim().max(200).optional(),
    companyName: z.string().trim().max(200).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(50).optional(),
  })
  .refine((p) => p.givenName || p.familyName || p.companyName || p.email, {
    message: "Provide at least a name, company or email address",
    path: ["givenName"],
  });
export type CreatePersonInput = z.infer<typeof createPersonInput>;

export async function createPerson(
  ctx: ServiceContext,
  schemeId: string,
  input: CreatePersonInput,
) {
  // One person per email per scheme: a duplicate would split their invite,
  // holdings and correspondence across two roll entries.
  if (input.email) {
    const existing = await ctx.db.query.people.findFirst({
      where: and(eq(people.schemeId, schemeId), eq(people.email, input.email)),
    });
    if (existing) {
      throw new DomainError(
        "DUPLICATE_PERSON",
        "Someone with that email address is already on the roll",
        409,
      );
    }
  }
  // Normalise empty strings to null so "no email" is one shape, not two.
  const rows = await ctx.db
    .insert(people)
    .values({
      schemeId,
      givenName: input.givenName || null,
      familyName: input.familyName || null,
      companyName: input.companyName || null,
      email: input.email || null,
      phone: input.phone || null,
    })
    .returning();
  return rows[0]!;
}

export async function listPeople(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.people.findMany({
    where: eq(people.schemeId, schemeId),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const pendingInvites = await ctx.db.query.invites.findMany({
    where: and(eq(invites.schemeId, schemeId), isNull(invites.acceptedAt)),
  });
  // An expired invite is not pending — the person must be invitable again,
  // otherwise they'd show "Invited" forever with no way to resend.
  const now = ctx.clock.now();
  const pendingPersonIds = new Set(
    pendingInvites.filter((i) => i.expiresAt > now).map((i) => i.personId),
  );
  // Current lot holdings, so the roll shows who owns what.
  const holdings = await ctx.db
    .select({ personId: ownerships.personId, lotId: lots.id, lotNumber: lots.lotNumber })
    .from(ownerships)
    .innerJoin(lots, eq(ownerships.lotId, lots.id))
    .where(and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)));
  return rows.map((p) => ({
    ...p,
    pendingInvite: pendingPersonIds.has(p.id),
    lots: holdings
      .filter((h) => h.personId === p.id)
      .map((h) => ({ lotId: h.lotId, lotNumber: h.lotNumber }))
      .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true })),
  }));
}

/** Members with login identities (for committee assignment pickers). */
export async function listMembers(ctx: ServiceContext, schemeId: string) {
  return await ctx.db
    .selectDistinctOn([memberships.userId], {
      userId: memberships.userId,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.schemeId, schemeId), isNull(memberships.endedOn)))
    .orderBy(memberships.userId);
}
