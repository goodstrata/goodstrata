import { invites, memberships, people, users } from "@goodstrata/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../context.js";

export const createPersonInput = z.object({
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});
export type CreatePersonInput = z.infer<typeof createPersonInput>;

export async function createPerson(
  ctx: ServiceContext,
  schemeId: string,
  input: CreatePersonInput,
) {
  const rows = await ctx.db
    .insert(people)
    .values({ schemeId, ...input })
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
  return rows.map((p) => ({
    ...p,
    pendingInvite: pendingInvites.some((i) => i.personId === p.id),
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
