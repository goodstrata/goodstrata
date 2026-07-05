import { invites, lots, memberships, ownerships, people, users } from "@goodstrata/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

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

/** Shape of `people.mailingAddress` (free-form jsonb; see documents-pdf.ts's addressLines). */
export const mailingAddressInput = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    suburb: z.string().trim().max(100).optional(),
    state: z.string().trim().max(50).optional(),
    postcode: z.string().trim().max(20).optional(),
  })
  .strict();
export type MailingAddressInput = z.infer<typeof mailingAddressInput>;

/** Partial update of a roll entry (APP 13 correction). Every field is optional. */
export const updatePersonInput = z
  .object({
    givenName: z.string().trim().max(200).optional(),
    familyName: z.string().trim().max(200).optional(),
    companyName: z.string().trim().max(200).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(50).optional(),
    /** `null` clears a previously recorded mailing address. */
    mailingAddress: mailingAddressInput.nullable().optional(),
  })
  .strict();
export type UpdatePersonInput = z.infer<typeof updatePersonInput>;

/**
 * Correct a roll entry's own details — the person-record equivalent of the
 * self-serve profile edit, but for the contact record an officer maintains on
 * someone's behalf (owners/tenants often never log in at all). Only supplied
 * fields are touched; omitted fields are left as they were.
 */
export async function updatePerson(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  input: UpdatePersonInput,
) {
  const existing = await ctx.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.id, personId)),
  });
  if (!existing) throw notFound("Person");

  // Same one-person-per-email rule as create: a correction shouldn't collide
  // with another roll entry.
  if (input.email && input.email !== existing.email) {
    const dupe = await ctx.db.query.people.findFirst({
      where: and(eq(people.schemeId, schemeId), eq(people.email, input.email)),
    });
    if (dupe && dupe.id !== personId) {
      throw new DomainError(
        "DUPLICATE_PERSON",
        "Someone with that email address is already on the roll",
        409,
      );
    }
  }

  const rows = await ctx.db
    .update(people)
    .set({
      ...(input.givenName !== undefined ? { givenName: input.givenName || null } : {}),
      ...(input.familyName !== undefined ? { familyName: input.familyName || null } : {}),
      ...(input.companyName !== undefined ? { companyName: input.companyName || null } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.mailingAddress !== undefined ? { mailingAddress: input.mailingAddress } : {}),
    })
    .where(eq(people.id, personId))
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
