import { funds, lots, memberships, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { schemeTier, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export const createSchemeInput = z.object({
  name: z.string().min(1).max(200),
  planOfSubdivision: z
    .string()
    .regex(/^PS\d{4,7}[A-Z]?$/i, "Expected a plan number like PS543210V"),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  suburb: z.string().min(1),
  state: z.string().default("VIC"),
  postcode: z.string().regex(/^\d{4}$/),
});
export type CreateSchemeInput = z.infer<typeof createSchemeInput>;

/**
 * Create a scheme in `onboarding` status with its two statutory funds, and
 * make the creating user its manager_admin.
 */
export async function createScheme(ctx: ServiceContext, input: CreateSchemeInput) {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Only a signed-in user can create a scheme", 403);
  }
  const userId = ctx.actor.id;

  return await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.schemes.findFirst({
      where: eq(schemes.planOfSubdivision, input.planOfSubdivision.toUpperCase()),
    });
    if (existing) {
      throw new DomainError(
        "SCHEME_EXISTS",
        `A scheme with plan ${input.planOfSubdivision} already exists`,
        409,
      );
    }

    const inserted = await tx
      .insert(schemes)
      .values({
        name: input.name,
        planOfSubdivision: input.planOfSubdivision.toUpperCase(),
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        suburb: input.suburb,
        state: input.state,
        postcode: input.postcode,
        tier: schemeTier(0),
      })
      .returning();
    const scheme = inserted[0]!;

    await tx.insert(funds).values([
      { schemeId: scheme.id, kind: "admin", name: "Administration fund" },
      { schemeId: scheme.id, kind: "maintenance", name: "Maintenance fund" },
    ]);

    await tx.insert(memberships).values({
      schemeId: scheme.id,
      userId,
      role: "manager_admin",
      startedOn: toDateOnly(ctx.clock.now()),
    });

    await publishEvent(tx, {
      schemeId: scheme.id,
      stream: `scheme:${scheme.id}`,
      type: "scheme.created",
      payload: {
        name: scheme.name,
        planOfSubdivision: scheme.planOfSubdivision,
        tier: scheme.tier,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return scheme;
  });
}

export async function getScheme(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  return scheme;
}

export async function listSchemesForUser(ctx: ServiceContext, userId: string) {
  const rows = await ctx.db
    .select({ scheme: schemes, role: memberships.role })
    .from(memberships)
    .innerJoin(schemes, eq(memberships.schemeId, schemes.id))
    .where(and(eq(memberships.userId, userId), isNull(memberships.endedOn)));
  return rows;
}

/** Active membership roles for a user in a scheme (drives authorization). */
export async function rolesForUser(ctx: ServiceContext, schemeId: string, userId: string) {
  const rows = await ctx.db.query.memberships.findMany({
    where: and(
      eq(memberships.schemeId, schemeId),
      eq(memberships.userId, userId),
      isNull(memberships.endedOn),
    ),
  });
  return rows.map((r) => r.role);
}

/** Recalculate tier from lot count (called after lot import). */
export async function recalculateTier(ctx: ServiceContext, schemeId: string) {
  const lotRows = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  const tier = schemeTier(lotRows.length);
  await ctx.db.update(schemes).set({ tier }).where(eq(schemes.id, schemeId));
  return tier;
}
